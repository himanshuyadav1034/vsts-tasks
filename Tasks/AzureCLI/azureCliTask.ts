/// <reference path="../../definitions/node.d.ts" />
/// <reference path="../../definitions/Q.d.ts" />
/// <reference path="../../definitions/vsts-task-lib.d.ts" />

import path = require('path');
import tl = require('vsts-task-lib/task');
var fs = require('fs');
tl.setResourcePath(path.join( __dirname, 'task.json'));
const publishSettingFileName = 'subscriptions.publishsettings';
function createPublishSettingFile (subscriptionName, subscriptionId , certificate)
{
	//writing the data to the publishsetting file 
	fs.writeFileSync(publishSettingFileName,'<?xml version="1.0" encoding="utf-8"?><PublishData><PublishProfile SchemaVersion="2.0" PublishMethod="AzureServiceManagementAPI"><Subscription ServiceManagementUrl="https://management.core.windows.net" Id="'
		+ subscriptionId + '" Name="' + subscriptionName +'" ManagementCertificate="'+ certificate + '" /> </PublishProfile></PublishData>');
}

function deletePublishSettingFile()
{
	//delete the publishsetting file created earlier
	fs.unlinkSync(publishSettingFileName);
}
function loginAzureRM(connectedService)
{
    var endpointAuth = tl.getEndpointAuthorization(connectedService, true);
    var endpointData= tl.getEndpointData(connectedService, true);
    var servicePrincipalId = endpointAuth.parameters["serviceprincipalid"];
    var servicePrincipalKey = endpointAuth.parameters["serviceprincipalkey"];
    var tenantId = endpointAuth.parameters["tenantid"];
    var subscriptionName=endpointData.SubscriptionName;
    //set the azure mode to arm to use azureRM commands
    var resultOfToolExecution = tl.execSync("azure", "config mode arm" );
    throwIfError(resultOfToolExecution);
    resultOfToolExecution = tl.execSync("azure", "login -u " + servicePrincipalId + " -p " + servicePrincipalKey + " --tenant " + tenantId + " --service-principal");
    throwIfError(resultOfToolExecution);
    //set the subscription imported to the current subscription
    resultOfToolExecution = tl.execSync("azure", "account set " + subscriptionName);
    throwIfError(resultOfToolExecution);
}
function loginAzureClassic(connectedService)
{
    var endpointAuth = tl.getEndpointAuthorization(connectedService, true);
    var endpointData= tl.getEndpointData(connectedService, true);
    //set the azure mode to asm to use azureRM commands
    var resultOfToolExecution = tl.execSync("azure", "config mode asm" );
    throwIfError(resultOfToolExecution);
    if (endpointAuth.scheme === "Certificate") {

        var bytes = endpointAuth.parameters["certificate"];
        var subscriptionName=endpointData.subscriptionName;
        var subscriptionId= endpointData.subscriptionId;
        createPublishSettingFile(subscriptionName, subscriptionId, bytes);
        resultOfToolExecution =tl.execSync("azure", "account import " + publishSettingFileName);
        deletePublishSettingFile();
        throwIfError(resultOfToolExecution);
        //set the subscription imported to the current subscription
        resultOfToolExecution = tl.execSync("azure", "account set " + subscriptionName);
        throwIfError(resultOfToolExecution);

    }
    else if (endpointAuth.scheme === "UsernamePassword") {
        var username = endpointAuth.parameters["username"];
        var passwd = endpointAuth.parameters["password"];
        resultOfToolExecution = tl.execSync("azure", "login -u " + username + " -p " + passwd );
        throwIfError(resultOfToolExecution);
        var subscriptionName=endpointData.subscriptionName;
        //set the subscription imported to the current subscription
        resultOfToolExecution = tl.execSync("azure", "account set " + subscriptionName);
        throwIfError(resultOfToolExecution);
    }
    else {
        throw("error : problem with authorization scheme, only UsernamePassword and Certificate is acceptable");
    }
}
function setInputsForBash()
{

}
function logoutAzureSubscription(connectedService)
{
    var endpointData= tl.getEndpointData(connectedService, true);
    var subscriptionName=endpointData.SubscriptionName;
    tl.execSync("azure", " account clear -s " + subscriptionName);

}
function logoutAzure(connectedService)
{
    var endpointAuth = tl.getEndpointAuthorization(connectedService, true);
    var username = endpointAuth.parameters["username"];
    tl.execSync("azure", "logout -u " + username);
}
function throwIfError(resultOfToolExecution)
{
	if(resultOfToolExecution.stderr)
	{
		throw resultOfToolExecution.stderr;
	}
}
export async function run() {
	try {
		var resultOfToolExecution;
        var connectedService;
        var loginStatus = false;
        //read all the inputs common to any scenario of endpoint provided such as subscriptionid and name
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
        var argString = (tl.getInput('args', false));
        // determines whether output to stderr will fail a task.
        // some tools write progress and other warnings to stderr.  scripts can also redirect.
        failOnStdErr= tl.getBoolInput('failOnStandardError', false);
		var code: number = await tl.exec("bash", scriptPath + " " + argString, {failOnStdErr: failOnStdErr});
	}
	catch(err) {
		//go to finally and logout of azure and set task result
	}
	finally {
		//log out of azure according to the authentication scheme. either logout using username or remove subscription from machine(service priniciple and certificate)
        var endpointAuth = tl.getEndpointAuthorization(connectedService, true);
        (endpointAuth.scheme === "UsernamePassword")? logoutAzure(connectedService) : logoutAzureSubscription(connectedService);
		//set the task result to either succeeded or failed based on error was thrown or not
        if(resultOfToolExecution.stderr)
            tl.setResult(tl.TaskResult.Failed, tl.loc('AzureFailed', resultOfToolExecution.stderr))
        if(code == 0)
            tl.setResult(tl.TaskResult.Succeeded, tl.loc('BashReturnCode', code));
        else
            tl.setResult(tl.TaskResult.Failed, tl.loc('BashReturnCode', code));
	}
}
run();