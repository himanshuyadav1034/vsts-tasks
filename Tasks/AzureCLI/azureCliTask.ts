/// <reference path="../../definitions/node.d.ts" />
/// <reference path="../../definitions/Q.d.ts" />
/// <reference path="../../definitions/vsts-task-lib.d.ts" />

import path = require('path');
import tl = require('vsts-task-lib/task');
var fs = require('fs');
var loginStatus:boolean = false;
tl.setResourcePath(path.join( __dirname, 'task.json'));
function createPublishSettingFile (subscriptionName:string, subscriptionId:string , certificate:string, publishSettingFileName:string)
{
    //writing the data to the publishsetting file
    try {
        fs.writeFileSync(publishSettingFileName,'<?xml version="1.0" encoding="utf-8"?><PublishData><PublishProfile SchemaVersion="2.0" PublishMethod="AzureServiceManagementAPI"><Subscription ServiceManagementUrl="https://management.core.windows.net" Id="'
            + subscriptionId + '" Name="' + subscriptionName +'" ManagementCertificate="'+ certificate + '" /> </PublishProfile></PublishData>');
    }
    catch(err) {
        if(fs.existsSync(publishSettingFileName))
        {
            deletePublishSettingFile(publishSettingFileName);
        }
        console.error("Error in writing PublishSetting File");
        throw err;
    }
}
function deletePublishSettingFile(publishSettingFileName:string)
{
    try{
        //delete the publishsetting file created earlier
        fs.unlinkSync(publishSettingFileName);
    }
    catch(err)
    {
        console.error("Error in deleting PublishSetting File");
        throw err;
    }
}
function loginAzureRM(connectedService:string)
{
    var endpointAuth = tl.getEndpointAuthorization(connectedService, true);
    var endpointData= tl.getEndpointData(connectedService, true);
    var servicePrincipalId:string = endpointAuth.parameters["serviceprincipalid"];
    var servicePrincipalKey:string = endpointAuth.parameters["serviceprincipalkey"];
    var tenantId:string = endpointAuth.parameters["tenantid"];
    var subscriptionName:string = endpointData["SubscriptionName"];
    //set the azure mode to arm to use azureRM commands
    var resultOfToolExecution = tl.execSync("azure", "config mode arm" );
    throwIfError(resultOfToolExecution);
    //login using svn
    resultOfToolExecution = tl.execSync("azure", "login -u " + servicePrincipalId + " -p " + servicePrincipalKey + " --tenant " + tenantId + " --service-principal");
    throwIfError(resultOfToolExecution);
    loginStatus=true;
    //set the subscription imported to the current subscription
    resultOfToolExecution = tl.execSync("azure", "account set " + subscriptionName);
    throwIfError(resultOfToolExecution);
}
function loginAzureClassic(connectedService)
{
    var endpointAuth = tl.getEndpointAuthorization(connectedService, true);
    var endpointData= tl.getEndpointData(connectedService, true);
    var subscriptionName:string = endpointData["subscriptionName"];
    //set the azure mode to asm to use azureRM commands
    var resultOfToolExecution = tl.execSync("azure", "config mode asm" );
    throwIfError(resultOfToolExecution);
    if (endpointAuth.scheme === "Certificate") {
        var bytes = endpointAuth.parameters["certificate"];
        var subscriptionId:string = endpointData["subscriptionId"];
        const publishSettingFileName:string = 'subscriptions.publishsettings';
        createPublishSettingFile(subscriptionName, subscriptionId, bytes, publishSettingFileName);
        resultOfToolExecution =tl.execSync("azure", "account import " + publishSettingFileName);
        deletePublishSettingFile(publishSettingFileName);
        throwIfError(resultOfToolExecution);
        loginStatus=true;
        //set the subscription imported to the current subscription
        resultOfToolExecution = tl.execSync("azure", "account set " + subscriptionName);
        throwIfError(resultOfToolExecution);
    }
    else if (endpointAuth.scheme === "UsernamePassword") {
        var username:string = endpointAuth.parameters["username"];
        var passwd:string = endpointAuth.parameters["password"];
        resultOfToolExecution = tl.execSync("azure", "login -u " + username + " -p " + passwd );
        throwIfError(resultOfToolExecution);
        loginStatus=true;
        //set the subscription imported to the current subscription
        resultOfToolExecution = tl.execSync("azure", "account set " + subscriptionName);
        throwIfError(resultOfToolExecution);
    }
    else {
        throw("error : problem with authorization scheme, only UsernamePassword and Certificate is acceptable");
    }
}
function logoutAzureSubscription(connectedServiceNameSelector:string, connectedService:string)
{
    var endpointData= tl.getEndpointData(connectedService, true);
    var subscriptionName:string = (connectedServiceNameSelector === 'connectedServiceNameARM')? endpointData["SubscriptionName"]: endpointData["subscriptionName"];
    var resultOfToolExecution =tl.execSync("azure", " acccount clear -s " + subscriptionName);
    throwIfError(resultOfToolExecution);
}
function logoutAzure(connectedService)
{
    var endpointAuth = tl.getEndpointAuthorization(connectedService, true);
    var username:string = endpointAuth.parameters["username"];
    var resultOfToolExecution =tl.execSync("azure", "logout -u " + username);
    throwIfError(resultOfToolExecution);
}
function throwIfError(resultOfToolExecution)
{
    if(resultOfToolExecution.stderr)
    {
        throw resultOfToolExecution;
    }
}
export async function run() {
    try {
        var connectedService:string;
        var resultOfToolExecution;
        var connectedServiceNameSelector = tl.getInput('connectedServiceNameSelector', true);
        if (connectedServiceNameSelector === 'connectedServiceNameARM') {
            connectedService = tl.getInput('connectedServiceNameARM', true);
            loginAzureRM(connectedService);
        }
        else{
            connectedService = tl.getInput('connectedServiceName', true);
            loginAzureClassic(connectedService);
        }

        //read the inputs such as scriptPath, cwd , arguments and options required to execute the bash script
        var scriptPath = tl.getPathInput('scriptPath', true, true);
        var cwd= tl.getPathInput('cwd', true, false);
        // if user didn't supply a cwd (advanced), then set cwd to folder script is in.
        // All "script" tasks should do this
        if (!tl.filePathSupplied('cwd')) {
            cwd = path.dirname(scriptPath);
        }
        tl.mkdirP(cwd);
        tl.cd(cwd);
        // additional args should always call argString.  argString() parses quoted arg strings
        var argString = tl.getInput('args', false);
        // determines whether output to stderr will fail a task.
        // some tools write progress and other warnings to stderr.  scripts can also redirect.
        var failOnStdErr= tl.getBoolInput('failOnStandardError', false);
        var code: number = await tl.exec("bash", scriptPath + " " + argString, {failOnStdErr: failOnStdErr});
    }
    catch(err) {
        resultOfToolExecution=err;
        //go to finally and logout of azure and set task result
    }
    finally {
        //log out of azure according to the authentication scheme. either logout using username or remove subscription from machine(service priniciple and certificate)
        if(loginStatus)
        {
            var endpointAuth = tl.getEndpointAuthorization(connectedService, true);
            try {
                (endpointAuth.scheme === "UsernamePassword")? logoutAzure(connectedService) : logoutAzureSubscription(connectedServiceNameSelector,connectedService);
            }
            catch(err)
            {
                console.error("logout of azure failed ");
            }
        }
        //set the task result to either succeeded or failed based on error was thrown or not
        if(resultOfToolExecution.stderr) {
            tl.setResult(tl.TaskResult.Failed, tl.loc('AzureFailed', resultOfToolExecution.stderr));
        }
        else if(code == 0) {
            tl.setResult(tl.TaskResult.Succeeded, tl.loc('BashReturnCode', code));
        }
        else {
            tl.setResult(tl.TaskResult.Failed, tl.loc('BashReturnCode', code));
        }
    }
}
run();