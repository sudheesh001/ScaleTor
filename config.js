var nodemailer = require('nodemailer');
var topology   = require(__dirname + '/topology');
var exec       = require('child_process').exec;
var Amazon     = require('aws-sdk');

exports.AWS = {
    key: 'key'
  , secret: 'secret'
}

exports.maxTorsPerInstance     = 8;
exports.maxActiveTorsOverlord  = 7;
exports.targetReserveSize      = 3;
exports.maxWipPerTor           = 5;
exports.maxWrapperStrikes      = 3;

exports.verbose               = false;
exports.rootPath              = __dirname;
exports.projectAdminEmail     = 'ADMINEMAIL@ADMINDOMAIN.COM';
exports.smtpTransport         = nodemailer.createTransport("SMTP", {service: "Gmail", auth: {user: "SAMPLEUSER@USER.COM", pass: "SAMPLEUSERPASSWORD"}});
exports.defaultSocks          = 9050;
exports.hospitalTimeoutLength = 60000;

var winston = exports.winston = require('winston');

if (process.env.NODE_ENV === "development") {
  winston.add(winston.transports.File, { filename: __dirname + '/logs/development.log' });
  exports.nodePath = '/usr/local/bin/node';
  exports.torPath  = '/usr/local/bin/tor';
  exports.topology = topology.development;
  exports.instanceName = 'localhost';
} else {
  winston.remove(winston.transports.Console);
  winston.add(winston.transports.File, { filename: __dirname + '/logs/production.log' });
  exports.nodePath = '/usr/bin/node';
  exports.torPath  = '/usr/sbin/tor';
  exports.topology = topology.production;
  exec('wget -q -O - http://169.254.169.254/latest/meta-data/instance-id', function (err, stdout, stderr) {
    exports.instanceName = stdout;
  });
}

Amazon.config.loadFromPath(__dirname + '/config/awsConfig.json');
exports.AWS = {
    key        : 'key'
  , secret     : 'secret'
  , S3         : new Amazon.S3()
};