var moment             = require('moment')
  , clone              = require('clone')
  , config             = require(__dirname + '/config')
  , smtpTransport      = config.smtpTransport
  , exec               = require('child_process').exec
  , fs                 = require('fs')
  , winston            = config.winston
  , S3                 = config.AWS.S3;
exports.datetimeFormat = 'YYYY-MM-DD HH:mm:ss';

///////////////////////////////////////////////////////////
////////////////////////// HTTP ///////////////////////////
///////////////////////////////////////////////////////////

exports.createHttpOptions = function (url, socksPort) {
  var parsedUrl = urlParser.parse(url);

  if (parsedUrl.protocol === 'https') {
    var port = 443;
  } else {
    var port = 80;
  }

  var httpOptions = {
      'hostname' : parsedUrl.host
    , 'port'     : port
    , 'headers'  : {'user-agent': randomUserAgent()}
    , 'path'     : parsedUrl.path
    , 'method'   : 'GET'
  };

  if (socksPort !== undefined) {
    httpOptions['socksPort'] = socksPort;
  }
  return httpOptions;
}


////////////////
///// ZMQ //////
////////////////

exports.readMessage = function (data) {
  return JSON.parse(data.toString());
}

exports.ping = function () {
  return JSON.stringify({headers: {type: 'ping'}, body: null});
}

////////////////
///// TOR //////
////////////////

exports.teardownTor = function (pidFile) {
  winston.info("pidFile " + pidFile);
  fs.readFile(pidFile, function (err, data) {
    if (err) throw err;
    var pid = data.toString().replace(/(\r\n|\n|\r)/gm,"");
    var command = "kill -9 " + pid;
    exec(command, function (err, stdout, stderr) {
      if (err)    winston.info("err " + err);
      if (stdout) winston.info("stdout " + stdout);
      if (stderr) winston.info("stderr " + stderr);
    });
  });
}

exports.now = function () {
  return moment.utc().format(exports.datetimeFormat);
}

//////////////////////
///  S3 RESOURCES  ///
//////////////////////

exports.saveFileToS3 = function(options, callback) { // {bucket:, filename:, body:}
  S3.putObject({Bucket: options.bucket, Key: options.filename, Body: options.body}, function (err, data) {
    callback(err, data);
  });
}

///////////////////////////
//////// Work Cache ///////
///////////////////////////
// Purpose: holds all work on the instance that's either todo or WIP

var WorkCache = exports.WorkCache = function () {
  this.todo = {};
  this.wip  = {};
}

WorkCache.prototype.addWork = function (targetHash, work) {
  this[targetHash][work.id] = work;
}

WorkCache.prototype.deleteWork = function (targetHash, work) {
  delete this[targetHash][work.id];
}

WorkCache.prototype.getWork = function (targetHash, work) {
  return this[targetHash][work.id];
}

WorkCache.prototype.wipIsFull = function (runningMode, work) {
  if (runningMode === 'regular') {
    var maxWipSize = config.maxWipPerRegular * config.maxActiveTorsOverlord;
  } else if (runningMode === 'tor') {
    var maxWipSize = config.maxWipPerTor * config.maxActiveTorsOverlord;
  }
  
  if (Object.size(this.wip) === maxWipSize) {
    var state = true;
  } else {
    var state = false;
  }
  return state;
}

WorkCache.prototype.getAnyWork = function (targetHash) {
  if (targetHash === undefined) throw "targetHash cannot be undefined";
  var workToReturn;
  for (key in this[targetHash]) {
    workToReturn = this[targetHash][key];
    break;
  }
  return workToReturn;
}

WorkCache.prototype.hasWork = function (targetHash) {
  var state = false;
  if (Object.size(this.todo) > 0) {
    state = true;
  }
  return state;
}

WorkCache.prototype.isEmpty = function (targetHash) {
  var state = true;
  if (Object.size(this.todo) > 0) {
    state = false;
  }
  return state;
}

////////////////////
// API-COMPLIANCE //
////////////////////

exports.createApiCompliantId = function (databaseName, table, id) {
  return (databaseName + "-" + table + "-" + id);
}

exports.upsteamApiCompliant = function (message) {
  var requiredKeys   = ['id', 'ingress_coupling_id', 'egress_coupling_id', 'url', 'storageOptions'];
  var requiredLength = requiredKeys.length;
  var compliant      = true;
  var strikes        = 0;

  if (Object.size(message) === requiredLength) {
    for (var i = 0; i < requiredKeys.length; i++) {
      if (requiredKeys[i] in message) {
        if (requiredKeys[i] === 'id') {
          if (typeof message['id'] === 'string') {
            var keys = message['id'].split('-');
            if (keys.length === 3) {
              if (isNaN(parseInt(keys[2]))) { // last field must be a number e.g. dbname-table-id
                strikes += 1;
              }
            } else {
              strikes += 1;
            }
          } else {
            strikes += 1;
          }
        }
      } else {
        strikes += 1;
      }
    }
  } else {
    strikes += 1;
  }

  if (strikes > 0) {
    compliant = false;
    winston.info("Warning: receiving buggy objects - upsteamApiCompliant failed on message = " + JSON.stringify(message));
    winston.info("Required keys: " + JSON.stringify(requiredKeys))
  }
  return compliant;
}

exports.downstreamApiCompliant = function (message) {
  var requiredKeys = ['id', 'ingress_coupling_id', 'egress_coupling_id', 'statusCode', 'headers', 'instanceName', 'socksPort'];
  var requiredLength = requiredKeys.length;
  var compliant      = true;
  var strikes        = 0;

  if (Object.size(message) === requiredLength) {
    for (var i = 0; i < requiredKeys.length; i++) {
      if (requiredKeys[i] in message) {
        if (requiredKeys[i] === 'id') {
          if (typeof message['id'] === 'string') {
            var keys = message['id'].split('-');
            if (keys.length === 3) {
              if (isNaN(parseInt(keys[2]))) { // last field must be a number e.g. dbname-table-id
                strikes += 1;
              }
            } else {
              strikes += 1;
            }
          } else {
            strikes += 1;
          }
        }
      } else {
        strikes += 1;
      }
    }
  } else {
    strikes += 1;
  }

  if (strikes > 0) {
    compliant = false;
    winston.info("Warning: creating buggy objects - downstreamApiCompliant failed on message = " + JSON.stringify(message));
  }
  return compliant;
}

////////////////////
/// LEGACY IPC  ////
////////////////////

exports.ipc = {};
exports.ipc.receiveMessage = function (data, callback) {
  var message = data.toString();
  var potentialMessage = message.match(/.+(?=\~\!\>)/i);
  if (potentialMessage !== null) {
    var theActualMessage = JSON.parse(potentialMessage);
    callback(theActualMessage);
  }
}

exports.ipc.send = function (message) {
  var stringified = JSON.stringify(message);
  console.log(stringified + "~!>"); // pseudo-ipc through stdout, done this way because I built it before I knew about ZMQ
}

////////////////
//// GENERAL ///
////////////////

exports.sendMail = function (options) { // var options = {subject: null, body: null};
  var mailOptions = {
      from   : "Node Project Mailer <nodeprojectmailer1@gmail.com>"
    , to     : config.projectAdminEmail
    , subject: options.subject
    , text   : options.body
    , html   : options.body
  }

  smtpTransport.sendMail(mailOptions, function (err, response) {
    if (err) throw err;
    winston.info("Message sent: " + response.message);
  });
}

Object.size = function (obj) {
  var size = 0, key;
  for (key in obj) {
    if (obj.hasOwnProperty(key)) size++;
  }
  return size;
}