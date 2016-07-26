/// <reference path="../../definitions/node.d.ts" />
/// <reference path="../../definitions/Q.d.ts" />
/// <reference path="../../definitions/vsts-task-lib.d.ts" />

import path = require('path');
import tl = require('vsts-task-lib/task');
var fs = require('fs');
function write (subscriptionName, SubscriptionId , Certificate)
{
	fs.writeFileSync('subscriptions.publishsettings','<?xml version="1.0" encoding="utf-8"?><PublishData><PublishProfile SchemaVersion="2.0" PublishMethod="AzureServiceManagementAPI"><Subscription ServiceManagementUrl="https://management.core.windows.net" Id="'
		+ SubscriptionId + '" Name="' + subscriptionName +'" ManagementCertificate="'+ Certificate + '" /> </PublishProfile></PublishData>');
}

function delFile()
{
	fs.unlinkSync('subscriptions.publishsettings');
}
var stderrThrow;async function run() {
    try {
		var bash = tl.createToolRunner(tl.which('bash', true));
        tl.setResourcePath(path.join( __dirname, 'task.json'));
		var azureConfig = tl.createToolRunner(tl.which('azure', true));
		var azureLogin = tl.createToolRunner(tl.which('azure', true));
		var azureSetSubscription = tl.createToolRunner(tl.which('azure', true));
		var ConnectedServiceNameSelector = tl.getInput('ConnectedServiceNameSelector', true);
		var stderrThrow, endpointAuth, endpointData, subscriptionName, subscriptionId;
		if (ConnectedServiceNameSelector === 'ConnectedServiceNameARM') {

			var connectedServiceNameARM = tl.getInput('ConnectedServiceNameARM', true);
			endpointAuth = tl.getEndpointAuthorization(connectedServiceNameARM, true);
			var servicePrincipalId = endpointAuth.parameters["serviceprincipalid"];
			var servicePrincipalKey = endpointAuth.parameters["serviceprincipalkey"];
			var tenantId = endpointAuth.parameters["tenantid"];

			endpointData= tl.getEndpointData(connectedServiceNameARM, true);
			subscriptionName = endpointData.SubscriptionName;

			azureConfig.argString("config mode arm");
			stderrThrow = azureConfig.execSync();
			if(stderrThrow.stderr)
			{
				throw(stderrThrow.stderr);
			}

			azureLogin.argString("login -u " + servicePrincipalId + " -p " + servicePrincipalKey + " --tenant " + tenantId + " --service-principal");
			stderrThrow = azureLogin.execSync();
			if(stderrThrow.stderr)
			{
				throw(stderrThrow.stderr);
			}

		}
		else{
			var connectedServiceName = tl.getInput('ConnectedServiceName', true);
			endpointAuth = tl.getEndpointAuthorization(connectedServiceName, true);
			endpointData = tl.getEndpointData(connectedServiceName, true);

			subscriptionId = endpointData.subscriptionId;
			subscriptionName = endpointData.subscriptionName;

			azureConfig.argString("config mode asm");
			stderrThrow = azureConfig.execSync();
			if(stderrThrow.stderr)
			{
				throw(stderrThrow.stderr);
			}

			if (endpointAuth.scheme === "Certificate") {
				var bytes = endpointAuth.parameters["certificate"];
				write(subscriptionName, subscriptionId, bytes);
				azureLogin.argString("account import subscriptions.publishsettings");
				stderrThrow = azureLogin.execSync();
				delFile();
				if(stderrThrow.stderr)
				{
					throw(stderrThrow.stderr);
				}
			}
			else if (endpointAuth.scheme === "UsernamePassword") {
				var username = endpointAuth.parameters["username"];
				var passwd = endpointAuth.parameters["password"];
				//if(!username || !passwd) error message and exit
				azureLogin.argString("login -u " + username + " -p " + passwd + " -q");
				stderrThrow = azureLogin.execSync();
				if(stderrThrow.stderr)
				{
					throw(stderrThrow.stderr);
				}

			}
			else {
				throw("error : problem with authorization scheme, only UsernamePassword and Certificate is acceptable");
			}
		}
		azureSetSubscription.argString("account set " + subscriptionName);
		stderrThrow = azureSetSubscription.execSync();
		if(stderrThrow.stderr)
		{
			throw(stderrThrow.stderr);
		}
		var scriptPath: string = tl.getPathInput('scriptPath', true, true);
        var cwd: string = tl.getPathInput('cwd', true, false);
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
        var failOnStdErr: boolean = tl.getBoolInput('failOnStandardError', false);
        //var code: number = await bash.exec(<any>{failOnStdErr: failOnStdErr});
        stderrThrow = await bash.exec(<any>{failOnStdErr: failOnStdErr});
        //tl.setResult(tl.TaskResult.Succeeded, tl.loc('BashReturnCode', code));
    }
    catch(err) {

	}
    finally {
        // add logout on failure or completion;
		var azureLogout = tl.createToolRunner(tl.which('azure', true));
		if (endpointAuth.scheme === "UsernamePassword") {
				azureLogout.argString("logout -u " + username );
				azureLogout.execSync();
			}
		else{
				azureLogout.argString(" account clear -s " + subscriptionName);
				azureLogout.execSync();
			}
			if(stderrThrow.stderr)
			{
				tl.setResult(tl.TaskResult.Failed, tl.loc('BashFailed', stderrThrow.stderr));
			}else{
				tl.setResult(tl.TaskResult.Succeeded, tl.loc('BashReturnCode', stderrThrow.stdout));
			}
    }   
}

run();