/// <reference path="../../definitions/node.d.ts" />
/// <reference path="../../definitions/Q.d.ts" />
/// <reference path="../../definitions/vsts-task-lib.d.ts" />

import path = require('path');
import tl = require('vsts-task-lib/task');
var fs = require('fs');
var ResultOfToolExecution, endpointAuth, endpointData, subscriptionName, subscriptionId, ConnectedServiceNameSelector;
var scriptPath:string , cwd:string, argString;
var failOnStdErr:boolean;
tl.setResourcePath(path.join( __dirname, 'task.json'));
const publishSettingFileName = 'subscriptions.publishsettings';
function createPublishSettingFile (subscriptionName, SubscriptionId , Certificate)
{
	//writing the data to the publishsetting file 
	fs.writeFileSync(publishSettingFileName,'<?xml version="1.0" encoding="utf-8"?><PublishData><PublishProfile SchemaVersion="2.0" PublishMethod="AzureServiceManagementAPI"><Subscription ServiceManagementUrl="https://management.core.windows.net" Id="'
		+ SubscriptionId + '" Name="' + subscriptionName +'" ManagementCertificate="'+ Certificate + '" /> </PublishProfile></PublishData>');
}

function delPublishSettingFile()
{
	//delete the publishsetting file created earlier
	fs.unlinkSync(publishSettingFileName);
}
function ReadAzureEndpointInput (typeOfService)
{
	ConnectedServiceNameSelector = typeOfService;
	//find if the end point is of type azureRM or azure Classic
	var connectedService = (ConnectedServiceNameSelector === 'ConnectedServiceNameARM' )? tl.getInput('ConnectedServiceNameARM', true) : tl.getInput('ConnectedServiceName', true);
	endpointAuth = tl.getEndpointAuthorization(connectedService, true);
	endpointData= tl.getEndpointData(connectedService, true);
	subscriptionName= (ConnectedServiceNameSelector === 'ConnectedServiceNameARM' )? endpointData.SubscriptionName : endpointData.subscriptionName;
	subscriptionId= (ConnectedServiceNameSelector === 'ConnectedServiceNameARM' )? endpointData.SubscriptionId : endpointData.subscriptionId;
}
function setInputsForBash()
{
	scriptPath = tl.getPathInput('scriptPath', true, true);
	cwd= tl.getPathInput('cwd', true, false);
	// if user didn't supply a cwd (advanced), then set cwd to folder script is in.
	// All "script" tasks should do this
	if (!tl.filePathSupplied('cwd')) {
		cwd = path.dirname(scriptPath);
	}
	tl.mkdirP(cwd);
	tl.cd(cwd);
	// additional args should always call argString.  argString() parses quoted arg strings
	argString = (tl.getInput('args', false));
	// determines whether output to stderr will fail a task.
	// some tools write progress and other warnings to stderr.  scripts can also redirect.
	failOnStdErr= tl.getBoolInput('failOnStandardError', false);
}
function CheckIfStderr(ResultOfToolExecution)
{
	if(ResultOfToolExecution.stderr)
	{
		throw ResultOfToolExecution.stderr;
	}
}
export async function run() {
	try {
		//read all the inputs common to any scenario of endpoint provided such as subscriptionid and name
		ReadAzureEndpointInput(tl.getInput('ConnectedServiceNameSelector', true));
		if (ConnectedServiceNameSelector === 'ConnectedServiceNameARM') {
			var servicePrincipalId = endpointAuth.parameters["serviceprincipalid"];
			var servicePrincipalKey = endpointAuth.parameters["serviceprincipalkey"];
			var tenantId = endpointAuth.parameters["tenantid"];
			//set the azure mode to arm to use azureRM commands
			ResultOfToolExecution = tl.execSync("azure", "config mode arm" );
			CheckIfStderr(ResultOfToolExecution);
			ResultOfToolExecution = tl.execSync("azure", "login -u " + servicePrincipalId + " -p " + servicePrincipalKey + " --tenant " + tenantId + " --service-principal");
			CheckIfStderr(ResultOfToolExecution);
		}
		else{
			//set the azure mode to asm for using the classic mode commands and services
			ResultOfToolExecution = tl.execSync("azure", "config mode asm" );
			CheckIfStderr(ResultOfToolExecution);
			if (endpointAuth.scheme === "Certificate") {
				var bytes = endpointAuth.parameters["certificate"];
				createPublishSettingFile(subscriptionName, subscriptionId, bytes);
				ResultOfToolExecution =tl.execSync("azure", "account import subscriptions.publishsettings");
				delPublishSettingFile();
				CheckIfStderr(ResultOfToolExecution);
			}
			else if (endpointAuth.scheme === "UsernamePassword") {
				var username = endpointAuth.parameters["username"];
				var passwd = endpointAuth.parameters["password"];
				ResultOfToolExecution = tl.execSync("azure", "login -u " + username + " -p " + passwd );
				CheckIfStderr(ResultOfToolExecution);
			}
			else {
				throw("error : problem with authorization scheme, only UsernamePassword and Certificate is acceptable");
			}
		}
		//set the subscription imported to the current subscription
		ResultOfToolExecution = tl.execSync("azure", "account set " + subscriptionName);
		CheckIfStderr(ResultOfToolExecution);
		//read the inputs such as scriptPath, cwd , arguments and options required to execute the bash script
		setInputsForBash();
		var code: number = await tl.exec("bash", scriptPath + " " + argString, {failOnStdErr: failOnStdErr});
	}
	catch(err) {
		//go to finally and logout of azure and set task result
	}
	finally {
		//log out of azure according to the authentication scheme
		(endpointAuth.scheme === "UsernamePassword")? tl.execSync("azure", "logout -u " + username) : tl.execSync("azure", " account clear -s " + subscriptionName);
		//set the task result to either succeeded or failed based on error was thrown or not
		(ResultOfToolExecution.stderr)?tl.setResult(tl.TaskResult.Failed, tl.loc('AzureFailed', ResultOfToolExecution.stderr)) : tl.setResult(tl.TaskResult.Succeeded, tl.loc('BashReturnCode', code));
	}
}
run();