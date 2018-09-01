const Handlebars = require('handlebars');
const chalk = require('chalk');
const moment = require('moment');
const { 
    always,
    compose,
    curryN, 
    flatten,
    pathOr,
    tap, 
    values,
    uniq,
    path,
    map,
} = require('ramda');
const { 
    createJiraLink,
    dateToRange,
    formatJiraTimeSpent,
    getDuration,
    getImportConfig,
    getIssueIdFromDescription,
    getJiraConfig,
    getPhrase,
    getZaebuttonConfig,
    issueIdP,
    issueSummaryP,
    keyP,
    promiseMapSequence,
    setTimeInDate,
    showError,
    showInfo,
    showPhrases,
    showPrompt, 
    showTimeEntry,
    showWarning, 
    terminate,
    toInt,
    unescapeText
} = require('./utils');
const { program } = require('./env');
const { 
    CANCEL_CODE,
    cmds,
    ISO8601_FORMAT,
    TIME_ENTRY_DATE_FORMAT,
    MILLISECONDS_IN_SECONDS
} = require('./constants');
const {
    promptSchemas
} = require('./configs');
const { 
    start: startZaebutton,
    stop: stopZaebutton,
    getCurrentWorklog: getCurrentZworklog,
    getWorklog: getZworklog
} = require('./api/zaebutton');
const {
    findIssue,
    addWorklog: addJiraWorklog,
    getCurrentUser
} = require('./api/jira');
const {
    createZworklogsMap,
    createJiraWorklogsMap,
    getDurationFromJiraWorklogs,
} = require('./import');

const invoke = curryN(3, (config, cmd, args) => {
    let promise = Promise.resolve();
    const { defaultIssue } = getJiraConfig(config);
    const zaebuttonConfig = getZaebuttonConfig(config);
    const importConfig = getImportConfig(config);
    const zaebuttonDescriptionTemplate = compose(unescapeText, Handlebars.compile(zaebuttonConfig.descriptionTemplate));

    switch (cmd) {
        case cmds.START: 
            let issueId;

            promise = Promise.resolve(args);

            if (!args) {
                showPhrases(config);
                promise = showPrompt(promptSchemas.custom, { name: chalk.blue('jira issue:') }); 
            }

            promise
                .then(tap(issueN => issueId = issueN))
                .then(findIssue)
                .catch(err => findIssue(defaultIssue))
                .then(issue => {
                    const phrase = getPhrase(config, issueId);
                    const issueKey = keyP(issue);
                    const worklog = {
                        start: moment().toISOString(),
                        projectId: zaebuttonConfig.projectId,
                        workspaceId: zaebuttonConfig.workspaceId,
                        description: issueKey === defaultIssue ? phrase : zaebuttonDescriptionTemplate({ issue })
                    };

                    if (!phrase || phrase === CANCEL_CODE) {
                        return;
                    } 

                    startZaebutton(worklog);
                });
            break;
        case cmds.STOP:
            let currentZworklog;

            promise = getCurrentZworklog(zaebuttonConfig)
                .then(tap(zWorklog => currentZworklog = zWorklog))
                .then(zWorklog => showTimeEntry(config, zWorklog))
                .then(() => { 
                    if (args) {
                        return args;
                    }

                    showPhrases(config);

                    return showPrompt(promptSchemas.custom, { name: chalk.blue('msg:'), required: false });
                })
                .then(rawPhrase => {
                    const phrase = getPhrase(config, rawPhrase);

                    return getCurrentZworklog(zaebuttonConfig)
                        .then(() => {
                            if (phrase === CANCEL_CODE) {
                                return;
                            }

                            return stopZaebutton(zaebuttonConfig)
                                .then(() => getZworklog({ worklogId: currentZworklog.id }))
                                .then(({ duration, start, description }) => {
                                    if (!phrase || !start) {
                                        return;
                                    }

                                    const jiraWorklog = {
                                        started: moment(start, moment.ISO_8601).format(ISO8601_FORMAT),
                                        timeSpent: formatJiraTimeSpent(duration),
                                        comment: phrase
                                    };

                                    const issueId = getIssueIdFromDescription(description);

                                    return findIssue(issueId)
                                        .then(() => issueId)
                                        .catch(() => defaultIssue)
                                        .then(issueId => addJiraWorklog(issueId, jiraWorklog));
                                });
                        });
                });

            break;
        case cmds.STATUS:
            promise = getCurrentZworklog(zaebuttonConfig)
                .then(worklog => showTimeEntry(config, worklog));

            break;
        case cmds.IMPORT:
            promise = Promise.resolve(args || moment().format(TIME_ENTRY_DATE_FORMAT));

            showInfo('fetching data...');

            promise.then(rawDate => {
                const dateRange = dateToRange(rawDate);

                return Promise.all(dateRange.map(createZworklogsMap(config)))
                .then(durationMapList => {
                    const issueIds = compose(
                        uniq,
                        map(issueIdP), 
                        flatten, 
                        map(values)
                    )(durationMapList);

                    return createJiraWorklogsMap(config, issueIds)
                        .then(allWorklogsMap => {
                            const durationMapListMapper = (durationMap, idx) => {
                                const date = dateRange[idx];
                                const durationList = values(durationMap);

                                const durationListMapper = ({ issueId, shortDescription, description, duration }) => {
                                    const jiraDuration = getDurationFromJiraWorklogs(
                                        config, 
                                        date, 
                                        issueId === shortDescription ? '' : description,
                                        allWorklogsMap[issueId]
                                    );
                                    const { deviation } = importConfig;
                                    const unbalance = Math.abs(duration - jiraDuration) > deviation;
                                    const jiraDurationText = formatJiraTimeSpent(moment.utc(Math.abs(duration - jiraDuration) * MILLISECONDS_IN_SECONDS));

                                    if (unbalance && duration > jiraDuration) {
                                        showInfo('============= new track =============');
                                        showInfo(`title: ${description}`);
                                        showInfo(`link: ${createJiraLink(config, issueId)}`);
                                        showInfo(`duration: ${jiraDurationText} (${duration - jiraDuration}s)`); 
                                        showInfo(`date: ${date.format(TIME_ENTRY_DATE_FORMAT)}`);
                                        showInfo('status: not added in jira');

                                        showPhrases(config);

                                        return showPrompt(promptSchemas.custom, { name: chalk.blue('comment:'), required: false })
                                            .then(msg => {
                                                const phrase = getPhrase(config, msg);

                                                if (!phrase || phrase === CANCEL_CODE) {
                                                    return;
                                                } 

                                                const worklog = {
                                                    started: setTimeInDate(date, importConfig.trackingTime).format(ISO8601_FORMAT),
                                                    timeSpent: jiraDurationText,
                                                    comment: phrase
                                                };

                                                return addJiraWorklog(issueId, worklog);
                                            });
                                    }

                                    if (unbalance && duration < jiraDuration) {
                                        showInfo('============= jira worklog =============', 'magenta');
                                        showInfo(`title: ${description}`, 'magenta');
                                        showInfo(`link: ${createJiraLink(config, issueId)}`, 'magenta');
                                        showInfo(`duration: ${jiraDurationText} (${jiraDuration - duration}s)`, 'magenta');
                                        showInfo(`date: ${date.format(TIME_ENTRY_DATE_FORMAT)}`, 'magenta');
                                        showInfo('status: worklog in jira is too big', 'magenta');
                                    }
                                };

                                return promiseMapSequence(durationList, durationListMapper);
                            };

                            return promiseMapSequence(durationMapList, durationMapListMapper);
                        });
                    });
                }
            );

            break;
        default: 
            showError(`${cmd} command not found`);
            program.help();
            terminate(1);
    }

    return promise
        .catch(err => showError(err));
});

module.exports = {
    cmds,
    invoke
};
