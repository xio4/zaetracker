const moment = require('moment');
const { 
    compose,
    curryN, 
    filter, 
    identity,
    pathOr,
    pathEq,
    reduce,
} = require('ramda');
const {
    startedP,
    getDurationInSeconds,
    getIssueIdFromDescription,
    getJiraConfig,
    getZaebuttonConfig,
    timeSpentSecondsP,
    dateToRange,
    reducePromise,
    worklogsP,
    commentP,
} = require('./utils');
const {
    getWorklogs: getZworklogs
} = require('./api/zaebutton');
const {
    findIssue,
    getWorklogs: getJiraWorklogs
} = require('./api/jira');

const authorKeyPath = ['author', 'key'];
const issuesCache = {};

const getDurationFromJiraWorklogs = curryN(4, (config, date, comment, worklogs) => {
    const startDate = date.clone().startOf('day');
    const { username } = getJiraConfig(config);

    return compose(
        reduce(
            (acc, worklog) => acc + timeSpentSecondsP(worklog),
            0
        ),
        filter(worklog => !comment || commentP(worklog) === comment),
        filter(worklog => moment(startedP(worklog)).startOf('day').diff(startDate, 'days') === 0),
        filter(pathEq(authorKeyPath, username))
    )(worklogs);
});

const getDurationsFromZworklogs = curryN(2, (config, zWorklogs) => 
    reducePromise(
        async (acc, { description, start, duration }) => {
            let issueId = getIssueIdFromDescription(description);
            const cachedIssue = issuesCache[issueId];

            if (!cachedIssue && cachedIssue !== false) {
                await findIssue(issueId)
                    .then(issue => issuesCache[issueId] = issue)
                    .catch(() => issuesCache[issueId] = false);
            }

            if (issuesCache[issueId] === false) {
                issueId = description;
            }

            acc[issueId] = {
                duration: pathOr(0, [issueId, 'duration'], acc) + duration,
                issueId: issueId === description ? getJiraConfig(config).defaultIssue : issueId,
                shortDescription: issueId,
                description
            };

            return acc;
        }, 
        {}, 
        zWorklogs
    )
);

const createZworklogsMap = curryN(2, async (config,  date) => {
    const startDate = date.clone().startOf('day');
    const endDate = date.clone().endOf('day');

    const worklogs = await getZworklogs({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        workspaceId: getZaebuttonConfig(config).workspaceId
    });

    return getDurationsFromZworklogs(config, worklogs);
});

const createJiraWorklogsMap = curryN(2, (config, issueIds) => reducePromise(async (acc, issueId) => {
    acc[issueId] = worklogsP(await getJiraWorklogs(issueId)
        .catch(() => [])
    );

    return acc;
}, {}, issueIds));

module.exports = {
    getDurationsFromZworklogs,
    getDurationFromJiraWorklogs,
    createZworklogsMap,
    createJiraWorklogsMap
};
