const { compose, pick, prop } = require('ramda');
const moment = require('moment');
const {
    MILLISECONDS_IN_SECONDS
} = require('../constants');
const { 
    createGet,
    createPost,
    createPut,
    createPromiseCb,
    findItemByName,
    getZaebuttonConfig,
    getBody,
    getData,
    idP,
    showError,
    terminate,
    wrapObjProperties
} = require('../utils');

class ZaebuttonClient {
    constructor(config) {
        this.config = config;

        const headers = {
            'Authorization': `${config.apiToken}:apiToken`,
            'Content-Type': 'application/json',
            'Access-Control-Request-Headers': 'authorization,content-type'
        };

        this.get = compose(getData, getBody, createGet(config.apiUrl, headers));
        this.post = compose(getData, getBody, createPost(config.apiUrl, headers));
        this.put = compose(getBody, createPut(config.apiUrl, headers));
    }

    getWorkspaces() {
        return this.get('workspaces');
    }

    getProjects({ workspaceId, archived = false }) {
        return this.get(`workspaces/${workspaceId}/projects?archived=${archived}`);
    }

    getCurrentWorklog({ workspaceId }) {
        return this.get(`worklogs/current?workspaceId=${workspaceId}`);
    }

    getWorklog({ worklogId }) {
        return this.get(`worklogs/${worklogId}`);
    }

    getWorklogs({ workspaceId, startDate, endDate, limit = 1000 }) {
        return this.get(`worklogs?workspaceId=${workspaceId}&startDate=${startDate}&endDate=${endDate}&limit=${limit}`);
    }

    createWorklog({ start, duration, description, projectId, workspaceId }) {
        return this.post(`worklogs`, { start, duration, description, projectId, workspaceId });
    }

    updateWorklog({ worklogId, start, duration, description, projectId }) {
        return this.put(`worklogs/${worklogId}`, { start, duration, description, projectId });
    }
}

let zaebutton;

const init = config => {
    zaebutton = new ZaebuttonClient(pick(['apiToken', 'apiUrl'], getZaebuttonConfig(config)));
};

const zaebuttonWrapper = fn => (...args) => {
    if (!zaebutton) {
        showError('Needs init zaebutton');
        terminate(1);
    }

    return fn(...args);
}

const start = ({ workspaceId, description, start, projectId }) => {
    return zaebutton.getCurrentWorklog({ workspaceId })
        .then(worklog =>
            worklog.start ?
                zaebutton.stop({ workspaceId }).then(() => zaebutton.getCurrentWorklog({ workspaceId })) :
                worklog
        )
        .then(({ id: worklogId }) => zaebutton.updateWorklog({ worklogId, start, projectId, description }));
};

const stop = ({ workspaceId }) => {
    return zaebutton.getCurrentWorklog({ workspaceId })
        .then(({ start, id, description, projectId }) => {
            if (!start) {
                return;
            }

            const duration = Math.round(+moment().subtract(+moment(start, moment.ISO_8601)) / MILLISECONDS_IN_SECONDS);

            return zaebutton.updateWorklog({ worklogId: id, start, description, projectId, duration });
        });
};

const getCurrentWorklog = config => {
    return zaebutton.getCurrentWorklog(config);
};

const getWorklog = config => {
    return zaebutton.getWorklog(config);
};

const getWorklogs = config => {
    return zaebutton.getWorklogs(config);
};

const findProject = config => {
    const zaebuttonConfig = getZaebuttonConfig(config);

    return zaebutton.getWorkspaces().then(
        workspaces => zaebutton.getProjects({
            workspaceId: idP(findItemByName(zaebuttonConfig.workspace, workspaces))
        })
    )
        .then(projects => findItemByName(zaebuttonConfig.project, projects));
};

const exportObj = {
    findProject,
    getCurrentWorklog,
    getWorklog,
    getWorklogs,
    start,
    stop
};
 
module.exports = {
    init,
    ...wrapObjProperties(zaebuttonWrapper, exportObj)
}; 
