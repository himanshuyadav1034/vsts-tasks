/// <reference path="../../definitions/node.d.ts" />
/// <reference path="../../definitions/Q.d.ts" />
/// <reference path="../../definitions/vsts-task-lib.d.ts" />

import path = require('path');
import tl = require('vsts-task-lib/task');

export class azureclitask {
    private static fs = require('fs');

    private static createPublishSettingFile(subscriptionName:string, subscriptionId:string, certificate:string, publishSettingFileName:string): void  {
        //writing the data to the publishsetting file
        try {
            this.fs.writeFileSync(publishSettingFileName, '<?xml version="1.0" encoding="utf-8"?><PublishData><PublishProfile SchemaVersion="2.0" PublishMethod="AzureServiceManagementAPI"><Subscription ServiceManagementUrl="https://management.core.windows.net" Id="'
                + subscriptionId + '" Name="' + subscriptionName + '" ManagementCertificate="' + certificate + '" /> </PublishProfile></PublishData>');
        }
        catch (err) {
            this.deletePublishSettingFile(publishSettingFileName);
            console.error("Error in writing PublishSetting File");
            throw err;
        }
    }

    private static loginStatus:boolean = false;

    private static deletePublishSettingFile(publishSettingFileName:string): void {
        if (this.fs.existsSync(publishSettingFileName)) {
            try {
                //delete the publishsetting file created earlier
                this.fs.unlinkSync(publishSettingFileName);
            }
            catch (err) {
                console.error("Error in deleting PublishSetting File");
                throw err;
            }
        }
    }

    private static loginAzureRM(connectedService:string): void {
        var endpointAuth = tl.getEndpointAuthorization(connectedService, true);
        var endpointData = tl.getEndpointData(connectedService, true);
        var servicePrincipalId:string = endpointAuth.parameters["serviceprincipalid"];
        var servicePrincipalKey:string = endpointAuth.parameters["serviceprincipalkey"];
        var tenantId:string = endpointAuth.parameters["tenantid"];
        var subscriptionName:string = endpointData["SubscriptionName"];
        //set the azure mode to arm to use azureRM commands
        this.throwIfError(tl.execSync("azure", "config mode arm"));
        //login using svn
        this.throwIfError(tl.execSync("azure", "login -u " + servicePrincipalId + " -p " + servicePrincipalKey + " --tenant " + tenantId + " --service-principal"));
        this.loginStatus = true;
        //set the subscription imported to the current subscription
        this.throwIfError(tl.execSync("azure", "account set " + subscriptionName));
    }

    private static loginAzureClassic(connectedService):void {
        var endpointAuth = tl.getEndpointAuthorization(connectedService, true);
        var endpointData = tl.getEndpointData(connectedService, true);
        var subscriptionName:string = endpointData["subscriptionName"];
        //set the azure mode to asm to use azureRM commands
        this.throwIfError(tl.execSync("azure", "config mode asm"));
        if (endpointAuth.scheme === "Certificate") {
            var bytes = endpointAuth.parameters["certificate"];
            var subscriptionId:string = endpointData["subscriptionId"];
            const publishSettingFileName:string = 'subscriptions.publishsettings';
            this.createPublishSettingFile(subscriptionName, subscriptionId, bytes, publishSettingFileName);
            var resultOfToolExecution = tl.execSync("azure", "account import " + publishSettingFileName);
            this.deletePublishSettingFile(publishSettingFileName);
            this.throwIfError(resultOfToolExecution);
            this.loginStatus = true;
            //set the subscription imported to the current subscription
            this.throwIfError( tl.execSync("azure", "account set " + subscriptionName));
        }
        else if (endpointAuth.scheme === "UsernamePassword") {
            var username:string = endpointAuth.parameters["username"];
            var passwd:string = endpointAuth.parameters["password"];
            this.throwIfError(tl.execSync("azure", "login -u " + username + " -p " + passwd));
            this.loginStatus = true;
            //set the subscription imported to the current subscription
            this.throwIfError(tl.execSync("azure", "account set " + subscriptionName));
        }
        else {
            throw("error : problem with authorization scheme, only UsernamePassword and Certificate is acceptable");
        }
    }

    private static logoutAzure(connectedServiceNameSelector:string)
    {
        var connectedService:string;
        if(connectedServiceNameSelector ==='ConnectedServiceNameARM')
        {
            connectedService = tl.getInput('connectedServiceNameARM', true);
            this.logoutAzureRM(connectedService);
        }
        else
        {
            connectedService = tl.getInput('connectedServiceName', true);
            this.logoutAzureClassic(connectedService);
        }
    }

    private static logoutAzureRM(connectedService:string)
    {
        var endpointData = tl.getEndpointData(connectedService, true);
        var subscriptionName:string =endpointData["SubscriptionName"];
        this.throwIfError(tl.execSync("azure", " account clear -s " + subscriptionName));
    }

    private static logoutAzureClassic(connectedService:string)
    {
        var endpointAuth = tl.getEndpointAuthorization(connectedService, true);
        if(endpointAuth["scheme"] === "usernamePassword")
        {
            var username:string = endpointAuth.parameters["username"];
            //var resultOfToolExecution = tl.execSync("azure", "logout -u " + username);
            this.throwIfError(tl.execSync("azure", "logout -u " + username));
        }
        else
        {
            var endpointData = tl.getEndpointData(connectedService, true);
            var subscriptionName:string = endpointData["subscriptionName"];
            this.throwIfError(tl.execSync("azure", " account clear -s " + subscriptionName));
        }
    }

    private static throwIfError(resultOfToolExecution):void {
        if (resultOfToolExecution.stderr) {
            throw resultOfToolExecution;
        }
    }

    public static async runMain() {
        try {
            var bash = tl.createToolRunner(tl.which('bash', true));
            var connectedService:string;
            var resultOfToolExecution= null;
            var connectedServiceNameSelector = tl.getInput('connectedServiceNameSelector', true);
            if (connectedServiceNameSelector === 'ConnectedServiceNameARM') {
                connectedService = tl.getInput('connectedServiceNameARM', true);
                this.loginAzureRM(connectedService);
            }
            else {
                connectedService = tl.getInput('connectedServiceName', true);
                this.loginAzureClassic(connectedService);
            }

            //read the inputs such as scriptPath, cwd , arguments and options required to execute the bash script
            var scriptPath = tl.getPathInput('scriptPath', true, true);
            var cwd = tl.getPathInput('cwd', true, false);
            // if user didn't supply a cwd (advanced), then set cwd to folder script is in.
            // All "script" tasks should do this
            if (!tl.filePathSupplied('cwd')) {
                cwd = path.dirname(scriptPath);
            }
            tl.mkdirP(cwd);
            tl.cd(cwd);
            bash.pathArg(scriptPath);
            // additional args should always call argString.  argString() parses quoted arg strings
            bash.argString(tl.getInput('args', false));
            // determines whether output to stderr will fail a task.
            // some tools write progress and other warnings to stderr.  scripts can also redirect.
            var failOnStdErr = tl.getBoolInput('failOnStandardError', false);
            var code: number = await bash.exec(<any>{failOnStdErr: failOnStdErr});        }
        catch (err) {
            resultOfToolExecution = err;
            //go to finally and logout of azure and set task result
        }
        finally {
            //Logout of Azure if logged in
            if (this.loginStatus) {
                this.logoutAzure(connectedServiceNameSelector);
            }
            tl.setResourcePath(path.join( __dirname, 'task.json'));
            //set the task result to either succeeded or failed based on error was thrown or not
            if (resultOfToolExecution) {
                tl.setResult(tl.TaskResult.Failed, tl.loc('BashFailed', resultOfToolExecution.stderr));
            }
            else {
                tl.setResult(tl.TaskResult.Succeeded, tl.loc('BashReturnCode', code));
            }
        }
    }
}
azureclitask.runMain();