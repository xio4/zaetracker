const program = require('commander');
const { values } = require('ramda');
const { VERSION, cmds, CMD, CMD_ARGS, CFG_PATH } = require('./constants');

program
    .version(process.env.npm_package_version || VERSION)
    .option(`-c, --${CMD} [type]`, `Command <${values(cmds).join(', ')}>`)
    .option(`-a, --${CMD_ARGS} [type]`, 'Command arguments in quotes')
    .option(`-g, --${CFG_PATH} [path]`, 'Config path in quotes')
    .parse(process.argv);
 
module.exports = {
    program
};
