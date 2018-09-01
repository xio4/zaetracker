#!/usr/bin/env node

const prompt = require('prompt');
const chalk = require('chalk');
const { loadConfig, terminate } = require('./utils');
const { program } = require('./env');
const { invoke } = require('./commands');
const { CFG_PATH, CMD, CMD_ARGS } = require('./constants');
const { init: initZaebutton, findProject } = require('./api/zaebutton.js');
const { init: initJira, getCurrentUser } = require('./api/jira');

const main = async () => {
    let config = await loadConfig(program[CFG_PATH]);

    initZaebutton(config);
    initJira(config);

    const zaebuttonProject = await findProject(config);
    const jiraUser = await getCurrentUser();

    config = {
        ...config,
        zaebutton: {
            ...config.zaebutton,
            projectId: zaebuttonProject.id,
            workspaceId: zaebuttonProject.workspaceId
        },
        jira: {
            ...config.jira,
            user: jiraUser
        }
    };

    await invoke(config, program[CMD], program[CMD_ARGS]);
};

if (!program.cmd) {
    program.help();
    terminate();
}

main();
