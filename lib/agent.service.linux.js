'use strict';

var fs = require('fs'),
	path = require('path');

module.exports = {
    install: function () {
        runInstall();
    },

    uninstall: function () {
        runUninstall();
    }
};

var options = {
    serviceId: null,
    serviceName: 'tellki-agent{{ID}}',

    agentFile: 'agent.js',
    agentCheckFlag: '-check',
    agentIdFlag: '-id',
    agentPidFile: 'agent{{ID}}pid',
    agentStartCmd: 'tellkiagent{{ID}}',

    serviceFilePath: '/etc/init.d/{{SERVICE_NAME}}',
    serviceFilePathPermissions: '700',

    cmdService: '{{SERVICE_FILE_PATH}} {{COMMAND}}',

    cmdUpdateRc: 'update-rc.d {{SERVICE_NAME}} defaults',
    cmdChkconfig: 'chkconfig --add {{SERVICE_NAME}}',
    cmdInsserv: 'insserv {{SERVICE_FILE_PATH}},start:lvl2,lvl3,lvl4,lvl5',

    cmdRemoveUpdateRc: 'update-rc.d -f {{SERVICE_NAME}} remove',
    cmdRemoveChkconfig: 'chkconfig --del {{SERVICE_NAME}}',
    cmdRemoveInsserv: 'insserv -r {{SERVICE_FILE_PATH}}'
};


function runInstall() {
    validateRootAccess(activateAgent);
}

function runUninstall() {
    validateRootAccess(stopService);
}

function validateRootAccess(callback) {
    var output = null;
    run('whoami',
		function onExit(code) {
		    if (code === 0) {
		        if (output === 'root') {
		            callback();
		        } else {
		            console.log('root access needed');
		        }
		    } else if (code === -1) {
		        console.log('Command whoami not found');
		    } else {
		        console.log('Error executing whoami');
		    }
		},
		function onStdOut(data) {
		    output = data.toString().trim();
		});
}

// ### Install methods

function activateAgent() {
    // Get arguments	
    var args = process.argv.splice(2, process.argv.length + 2);
    args.push(options.agentCheckFlag); // Add AGENT_CHECK_FLAG to arguments

    // Execute
    var agentFile = path.join(path.dirname(fs.realpathSync(__filename)), options.agentFile);

    var child = require('child_process').fork(agentFile, args, { env: process.env, execArgv: ['--expose-gc'] });
    child.on('exit', function (code) {
        if (code === 0) {
            processInitFile(args);
        } else {
            console.log('Error activating tellki-agent');
            process.exit(1);
        }
    });
}

function processInitFile(args) {
    // Get service ID
    options.serviceId = null;
    for (var i = 0; i < args.length; i++) {
        if (args[i] === options.agentIdFlag) {
            options.serviceId = args[i + 1];
            break;
        }
    }

    // Setup service name
    options.serviceName = (options.serviceId === null || options.serviceId === undefined)
		? options.serviceName.replace(/{{ID}}/g, '')
		: options.serviceName.replace(/{{ID}}/g, '.' + options.serviceId);

    // Setup agent pid file
    options.agentPidFile = (options.serviceId === null || options.serviceId === undefined)
		? options.agentPidFile.replace(/{{ID}}/g, '.')
		: options.agentPidFile.replace(/{{ID}}/g, '.' + options.serviceId + '.');

    // Setup start cmd
    options.agentStartCmd = (options.serviceId === null || options.serviceId === undefined)
		? options.agentStartCmd.replace(/{{ID}}/g, '')
		: options.agentStartCmd.replace(/{{ID}}/g, ' ' + options.agentIdFlag + ' ' + options.serviceId);

    // Setup replace vars
    var pathS = path.dirname(fs.realpathSync(__filename)) + '/../';
    var serviceNameS = options.serviceName;
    var pidFileS = options.agentPidFile;
    var startCmdS = options.agentStartCmd;

    // Replace vars
    var data = options.INIT_SCRIPT;
    data = data.replace(/{{PATH_S}}/g, pathS);
    data = data.replace(/{{SERVICE_NAME_S}}/g, serviceNameS);
    data = data.replace(/{{PIDFILE_S}}/g, pidFileS);
    data = data.replace(/{{STARTCMD_S}}/g, startCmdS);

    // Write init file to disk
    options.serviceFilePath = options.serviceFilePath.replace(/{{SERVICE_NAME}}/g, options.serviceName);

    fs.writeFile(options.serviceFilePath, data, function (err) {
        if (err) {
            console.log('Error writing init file');
            process.exit(1);
        }
        setInitPermissions();
    });
}

function setInitPermissions() {
    fs.chmod(options.serviceFilePath, options.serviceFilePathPermissions, function (err) {
        if (err) {
            console.log('Error setting init file permissions');
            process.exit(1);
        }
        registerWithUpdaterc();
    });
}

function registerWithUpdaterc() {
    // Run update-rc.d
    options.cmdUpdateRc = options.cmdUpdateRc.replace(/{{SERVICE_NAME}}/g, options.serviceName);
    runRegister(options.cmdUpdateRc, function () { setService('start', finish); }, registerWithChkconfig);
}

function registerWithChkconfig() {
    // Run chkconfig
    options.cmdChkconfig = options.cmdChkconfig.replace(/{{SERVICE_NAME}}/g, options.serviceName);
    runRegister(options.cmdChkconfig, function () { setService('start', finish); }, registerWithInsserv);
}

function registerWithInsserv() {
    // Run insserv
    options.cmdInsserv = options.cmdInsserv.replace(/{{SERVICE_FILE_PATH}}/g, options.serviceFilePath);
    runRegister(options.cmdInsserv,
		function () { setService('start', finish); },
		function () {
		    console.log('Unable to install tellki-agent service');
		    process.exit(1);
		});
}

// ### Uninstall methods

function stopService() {
    // Get service ID
    var args = process.argv.splice(2, process.argv.length + 2);

    options.serviceId = null;
    for (var i = 0; i < args.length; i++) {
        if (args[i] === options.agentIdFlag) {
            options.serviceId = args[i + 1];
            break;
        }
    }

    options.serviceName = (options.serviceId === null || options.serviceId === undefined)
		? options.serviceName.replace(/{{ID}}/g, '')
		: options.serviceName.replace(/{{ID}}/g, '.' + options.serviceId);

    options.serviceFilePath = options.serviceFilePath.replace(/{{SERVICE_NAME}}/g, options.serviceName);

    setService('stop', unregisterWithUpdaterc);
}

function unregisterWithUpdaterc() {
    // Run update-rc.d
    options.cmdRemoveUpdateRc = options.cmdRemoveUpdateRc.replace(/{{SERVICE_NAME}}/g, options.serviceName);
    runRegister(options.cmdRemoveUpdateRc, deleteInitFile, unregisterWithChkconfig);
}

function unregisterWithChkconfig() {
    // Run chkconfig
    options.cmdRemoveChkconfig = options.cmdRemoveChkconfig.replace(/{{SERVICE_NAME}}/g, options.serviceName);
    runRegister(options.cmdRemoveChkconfig, deleteInitFile, unregisterWithInsserv);
}

function unregisterWithInsserv() {
    // Run insserv
    options.cmdRemoveInsserv = options.cmdRemoveInsserv.replace(/{{SERVICE_FILE_PATH}}/g, options.serviceFilePath);
    runRegister(options.cmdRemoveInsserv, deleteInitFile, function () {
        console.log('Unable to uninstall tellki-agent service');
        process.exit(1);
    });
}

function deleteInitFile() {
    // Delete init file.
    fs.unlink(options.serviceFilePath, function (err) {
        if (err) {
            console.log('Error deleting init file');
            process.exit(1);
        }
        finish();
    });
}

// ### Util

// Run service with the given command
function setService(command, callback) {
    // Run start service
    options.cmdService = options.cmdService.replace(/{{SERVICE_FILE_PATH}}/g, options.serviceFilePath);
    options.cmdService = options.cmdService.replace(/{{COMMAND}}/g, command);
    run(options.cmdService,
		function onExit(code) {
		    if (code === 0) {
		        callback();
		    } else {
		        console.log('Error sending ' + command + ' to service');
		        process.exit(1);
		    }
		});
}

// Run register command with support for 'command not found'
function runRegister(cmd, successCallback, notFoundCallback) {
    run(cmd,
		function onExit(code) {
		    if (code === -1) {
		        notFoundCallback();
		    } else if (code === 0) {
		        successCallback();
		    } else {
		        console.log('Error executing ' + cmd);
		        process.exit(1);
		    }
		});
}

// Run command
function run(cmd, onCloseCallback, onStdoutCallback) {
    var tokens = cmd.split(' ');
    var cmd = tokens[0];
    var args = [];
    if (tokens.length > 1) {
        tokens.splice(0, 1);
        args = tokens;
    }
    var exec = require('child_process').spawn(cmd, args, { env: process.env });
    exec.on('close', onCloseCallback);
    exec.on('error', function () { });
    if (onStdoutCallback !== undefined)
        exec.stdout.on('data', onStdoutCallback);
}

function finish() {
    // All done, exit
    process.exit(0);
}

options.INIT_SCRIPT = "\
#! /bin/sh\n\
#\n\
# Written by Guberni\n\
# tellki-agent: The agent for Tellki - an IT monitoring and management SaaS service.\n\
# http://www.tellki.com\n\
#\n\
# chkconfig: 345 85 15\n\
#\n\
### BEGIN INIT INFO\n\
# Provides:          tellki-agent\n\
# Required-Start:\n\
# Required-Stop:\n\
# Default-Start:     2 3 4 5\n\
# Default-Stop:      0 1 6\n\
# Short-Description: Start and stop Tellki Agent\n\
# Description: Tellki Agent is used with the Tellki monitoring SaaS service.\n\
### END INIT INFO\n\
\n\
AGENTUSER=\"root\"\n\
PATH_A={{PATH_S}}\n\
SERVICE_NAME={{SERVICE_NAME_S}}\n\
PIDFILE=\"$PATH_A/cfg/{{PIDFILE_S}}\"\n\
\n\
if [ -f /etc/init.d/functions ]; then\n\
        . /etc/init.d/functions\n\
fi\n\
\n\
if [ -f /etc/SuSE-release ]; then\n\
        . /etc/rc.status\n\
        rc_reset\n\
fi\n\
\n\
case \"$1\" in\n\
  start)\n\
		if [ $(ps -p $(cat $PIDFILE) | grep tellki-agent | wc -l) -gt 0 ]; then\n\
			echo -n \"$SERVICE_NAME is already running\\n\"\n\
			exit 1\n\
		fi\n\
		\n\
		echo -n \"Starting $SERVICE_NAME\"\n\
		su $AGENTUSER -c \"{{STARTCMD_S}} &\"\n\
		\n\
		if [ -f /etc/SuSE-release ]; then\n\
			rc_status -v\n\
		elif [ -f /etc/debian_version ] || [ -f /etc/lsb-release ] || [ -f /etc/gentoo-release ]; then\n\
			echo \"Init Status: Started\\n\"\n\
		else\n\
			success\n\
			echo\n\
		fi\n\
		echo\n\
    ;;\n\
	\n\
  stop)\n\
		echo -n \"Stopping $SERVICE_NAME\"\n\
		kill -9 $(cat $PIDFILE) > /dev/null\n\
		\n\
		if [ -f /etc/SuSE-release ]; then\n\
			rc_status -v\n\
		elif [ -f /etc/debian_version ] || [ -f /etc/lsb-release ] || [ -f /etc/gentoo-release ]; then\n\
			echo \"Init Status: Stopped\\n\"\n\
		else\n\
			success\n\
			echo\n\
		fi\n\
		echo\n\
	;;\n\
	\n\
  status)\n\
		if [ $(ps -p $(cat $PIDFILE) | grep tellki-agent | wc -l) -gt 0 ]; then\n\
			echo -n \"$SERVICE_NAME is running\"\n\
			return 0\n\
		else\n\
			echo -n \"$SERVICE_NAME is not running\\n\"\n\
		fi\n\
	;;\n\
	\n\
  *)\n\
	echo \"Usage: /etc/init.d/$SERVICE_NAME start|stop|status\\n\"\n\
    exit 1\n\
esac\n\
\n\
exit 0\n\
"