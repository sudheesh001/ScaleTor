var config           = require(__dirname + '/config')
  , S3               = config.AWS.S3
  , bootstrap        = require(__dirname + '/bootstrap')
  , utils            = require(__dirname + '/utils')
  , http             = require('socks5-http-client')
  , url              = require('url')
  , knox             = require('knox')
  , zlib             = require('zlib')
  , MultiPartUpload  = require('knox-mpu')
  , clone            = require('clone')
  , zmq              = require('zmq')
  , tor              = require(__dirname + '/tor')
  , exec             = require('child_process').exec
  , path             = require('path')
  , winston          = config.winston;

var workServerEnvelopes = {};
var TORS_CREATED = 0;

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////// Pipeline Dealer ///////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Purpose: receive work from the pipelineServer and send finished work back to it
// Implementation: proxy messages to the workServer by notifying it of updates to workCache

var pipelineDealer = zmq.socket('dealer');
pipelineDealer.identity = 'pipelineDealer' + process.pid;
pipelineDealer.connect(config.topology.pipelineServer);

winston.info(pipelineDealer.identity + ' connected to ' + config.topology.pipelineServer);
var message = JSON.stringify({headers: {type: 'connect'}, body: null});
pipelineDealer.send(message);
winston.info(pipelineDealer.identity + " sent " + message);

setInterval(function() {
  pipelineDealer.send(utils.ping());
}, 1000);

pipelineDealer.on('message', function(data) {
  var message = utils.readMessage(data);
  if (message.headers.type !== 'ping') winston.info(pipelineDealer.identity + " received " + JSON.stringify(message));

  switch (message.headers.type) {
    case 'connected':
      var reply = JSON.stringify({headers: {type: 'identity', topic: 'getWorkFromPipeline'}, body: null});
      pipelineDealer.send(reply);
      winston.info(pipelineDealer.identity + " sent " + reply);
      break;
    case 'ping':
      setTimeout(function() {
        pipelineDealer.send(utils.ping());
      }, 1000);
      break;
    case 'broadcast': // aka: To: "All Tor instances", Message: "There is work available in the pipeline"
      if (message.headers.topic === 'workInPipeline') {
        var reply = JSON.stringify({headers: {type: 'identity', topic: 'getWorkFromPipeline'}, body: null});
        pipelineDealer.send(reply);
        winston.info(pipelineDealer.identity + " received broadcast " + JSON.stringify(message) + " sent reply " + reply);
      }
      break;
    case 'identity':  // aka: Hi, I'm an instance. Please send me work.
      if (message.headers.topic === 'workFromPipeline') {
        var work = message.body;
        if (utils.upsteamApiCompliant(work) === true) {
          workCache.addWork('todo', work);
          var reply = JSON.stringify({headers: {type: 'broadcast', topic: 'workAddedToCache'}, body: null});
          for (envelope in workServerEnvelopes) {
            workServer.send([envelope, reply]);  
            winston.info(workServer.identity + " sent to " + envelope + " this broadcast = " + reply);
          }
        }
      }
      break;
  }
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////// Work Server ///////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Purpose: distribute work to tor wrappers
// Implementation: 
// - receive 'workCache updated' alerts from the pipelineServer
// - broadcast to all tor wrappers
// - tor wrappers use identity requests to get new work from the workServer
// - workServer pulls work from the workCache

var workServer = zmq.socket('router');
workServer.identity = 'workServer' + process.pid;
workServer.bind(config.topology.workServer, function(err) {
  if (err) throw err;
  winston.info('workServer bound!');

  workServer.on('message', function(envelope, data) {
    var message  = utils.readMessage(data);
    var envelope = envelope.toString();

    if (message.headers.type !== 'ping') winston.info(workServer.identity + " received from " + envelope + " this message = " + JSON.stringify(message));
    switch (message.headers.type) {
      case 'connect':
        winston.info("Connected: " + envelope);
        workServerEnvelopes[envelope] = Date.now();
        var reply = JSON.stringify({headers: {type: 'connected'}, body: null});
        workServer.send([envelope, reply]);
        workServer.send([envelope, utils.ping()]);
        break;
      case 'ping':
        workServerEnvelopes[envelope] = Date.now();
        workServer.send([envelope, utils.ping()]);
        setTimeout(function() {
          if (envelope in workServerEnvelopes) {
            if (Date.now() - workServerEnvelopes[envelope] > 5000) {
              delete workServerEnvelopes[envelope];
              winston.info("Worker " + envelope + " has failed silently"); // silent failure
            }
          }
        }, 10000);
        break;
      case 'delete': // noisy failure
        winston.info(envelope + " has failed noisily");
        delete workServerEnvelopes[envelope];
        break;
      case 'identity':
        switch (message.headers.topic) {
          case 'getWorkFromCache': // a request from torWrapper
            var work = workCache.getAnyWork('todo');
            if (work !== undefined) {
              workCache.deleteWork('todo', work);
              workCache.addWork('wip', work);
              var reply = JSON.stringify({headers: {type: 'identity', topic: 'workFromCache'}, body: work});
              workServer.send([envelope, reply]);
              winston.info(workServer.identity + " sent to " + envelope + " this message = " + reply);
            } else {
              var reply = JSON.stringify({headers: {type: 'identity', topic: 'getWorkFromPipeline'}, body: null});
              pipelineDealer.send(reply);
              winston.info(pipelineDealer.identity + " sent " + reply);
            }
            break;
          case 'returnWorkUnfinished':
            var work = message.body;
            workCache.deleteWork('wip', work);
            workCache.addWork('todo', work);
            
            // if (workCache.isEmpty()) {
              var reply = JSON.stringify({headers: {type: 'broadcast', topic: 'workAddedToCache'}, body: null});
              for (envelope in workServerEnvelopes) {
                workServer.send([envelope, reply]);  
                winston.info(workServer.identity + " sent to " + envelope + " broadcast " + reply);
              }
            // }
            break;
          case 'workFailed':
            var work = message.body;
            workCache.deleteWork('wip', work);
            workCache.addWork('todo', work);
            
            // if (workCache.isEmpty()) {
              var reply = JSON.stringify({headers: {type: 'broadcast', topic: 'workAddedToCache'}, body: null});
              for (envelope in workServerEnvelopes) {
                workServer.send([envelope, reply]);  
                winston.info(workServer.identity + " sent to " + envelope + " broadcast " + reply);
              }
            // }
            break;
          case 'workDone':
            var work = message.body;
            workCache.deleteWork('wip', work);

            var reply = JSON.stringify({headers: {type: 'identity', topic: 'workForPipelineDone'}, body: message.body});
            pipelineDealer.send(reply);
            winston.info(pipelineDealer.identity + " sent this message = " + reply);

            var work = workCache.getAnyWork('todo');
            if (work !== undefined) {
              workCache.deleteWork('todo', work);
              workCache.addWork('wip', work);
              var reply = JSON.stringify({headers: {type: 'identity', topic: 'workFromCache'}, body: work});
              workServer.send([envelope, reply]);
              winston.info(workServer.identity + " sent to " + envelope + " this message = " + reply);
            } else {
              var reply = JSON.stringify({headers: {type: 'identity', topic: 'getWorkFromPipeline'}, body: null});
              pipelineDealer.send(reply);
              winston.info(pipelineDealer.identity + " sent " + reply);
            }
            break;
        }
    }
  });
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////// Initialize ////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

exports.init = function (argument) {
  var teardownPath = path.join(__dirname, '/teardown.js');
  var teardownCommand = config.nodePath + " " + teardownPath;

  exec(teardownCommand, function (err, stdout, stderr) {
    if (err) throw err;
    if (stderr) throw stderr;
    winston.info("Bootstrapping " + config.maxTorsPerInstance + " tors. Please wait...");
    TORS_CREATED = config.maxTorsPerInstance;
    for (var i = 0; i < config.maxTorsPerInstance; i++) {
      var options = {socksPort: (config.defaultSocks + i)};
      bootstrap.launchTor(options);
    }
  });
}

exports.torLoaded = function (message) { // This gets called by bootstrap.js as tors come online
  winston.info(message.socksPort + " just loaded. Adding to reserve.");
  var torWrapper = new TorWrapper(message.socksPort, message.pidFile);
  overlord.addTor('reserve', torWrapper);
  if (overlord.spaceForActiveTors()) {
    winston.info(message.socksPort + " moving from reserve to active");
    overlord.moveFromReserveToActive(torWrapper);
  }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////// Overlord //////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Purpose: makes sure there are always healthy tors doing their job and that unhealthy tors not getting any work

var Overlord = function () {
  this.reserve  = {};
  this.active   = {};
  this.hospital = {};
}

Overlord.prototype.spaceForActiveTors = function () {
  var state = false;
  if (this.getHashLength('active') < config.maxActiveTorsOverlord) {
    state = true;
  }
  return state;
}

Overlord.prototype.addTor = function (targetHash, torWrapper) {
  this[targetHash][torWrapper.socksPort] = torWrapper; // e.g. this.reserve.9050
  winston.info("STATE of Overlord => Reserve: " + Object.size(this.reserve) + " Active: " + Object.size(this.active) + " Hospital: " + Object.size(this.hospital));
}

Overlord.prototype.moveFromReserveToActive = function (torWrapper) {
  this.deleteTor('reserve', torWrapper);
  this.addTor('active', torWrapper);
  torWrapper.connect();
  winston.info("STATE of Overlord => Reserve: " + Object.size(this.reserve) + " Active: " + Object.size(this.active) + " Hospital: " + Object.size(this.hospital));
  this.checkReserve();
}

Overlord.prototype.checkReserve = function () {
  if (overlord.reserveSize() < config.targetReserveSize) {
    var recoveredSocksPort = config.defaultSocks + TORS_CREATED;
    bootstrap.launchTor({socksPort: recoveredSocksPort});
    TORS_CREATED += 1;
    winston.info("Auto recover is launching a new tor on socksPort " + recoveredSocksPort);
  }
}

Overlord.prototype.reserveSize = function () {
  return Object.size(this.reserve);
}

Overlord.prototype.getTor = function (targetHash, torWrapper) {
  return this[targetHash][torWrapper.socksPort];
}

Overlord.prototype.getAnyTor = function (targetHash) {
  var torWrapperToReturn;
  for (key in this[targetHash]) {
    torWrapperToReturn = this[targetHash][key];
    break;
  }
  return torWrapperToReturn;
}

Overlord.prototype.isHashEmpty = function (targetHash) {
  var state = true;
  if (Object.size(this[targetHash]) > 0) {
    state = false;
  }
  return state;
}

Overlord.prototype.getHashLength = function (targetHash) {
  return Object.size(this[targetHash]);
}

Overlord.prototype.deleteTor = function (targetHash, torWrapper) {
  delete this[targetHash][torWrapper.socksPort];
}

Overlord.prototype.autoRecover = function (torWrapper) {
  this.disconnectTor(torWrapper);
  torWrapper.addStrike();
  if (torWrapper.strikes < config.maxTorWrapperStrikes) {
    this.moveFromActiveToHospital(torWrapper);  
  } else {
    utils.teardownTor(torWrapper.pidFile);
  }
  
  var replacementTor = this.getAnyTor('reserve');
  if (replacementTor !== undefined) {
    if (this.spaceForActiveTors()) {
      this.moveFromReserveToActive(replacementTor);  
    }
  }
  this.checkReserve();
}

Overlord.prototype.disconnectTor = function (torWrapper) {
  var message = JSON.stringify({headers: {type: 'delete'}, body: null});
  torWrapper.wrapperSocket.send(message);
  winston.info(torWrapper.wrapperSocket.identity + " sent " + message);
  torWrapper.wrapperSocket.close();
}

Overlord.prototype.moveFromActiveToHospital = function (torWrapper) {
  this.deleteTor('active', torWrapper);
  this.addTor('hospital', torWrapper);
  setTimeout(function (myTorWrapper, thatOverlord) {
    thatOverlord.moveFromHospitalToReserve(myTorWrapper);
  }, config.hospitalTimeoutLength, torWrapper, this);
  winston.info("STATE of Overlord => Reserve: " + Object.size(this.reserve) + " Active: " + Object.size(this.active) + " Hospital: " + Object.size(this.hospital));
}

Overlord.prototype.moveFromHospitalToReserve = function (torWrapper) {
  this.deleteTor('hospital', torWrapper);
  this.addTor('reserve', torWrapper);
  winston.info("STATE of Overlord => Reserve: " + Object.size(this.reserve) + " Active: " + Object.size(this.active) + " Hospital: " + Object.size(this.hospital));
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////// TorWrapper ////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Purpose: provides an interface between raw tors and the application to enable error handling, auto-recovery, etc
// Implementation: a wrapper is just one of many wrappers inside of the overlord

var TorWrapper = function (socksPort, pidFile) {
  this.socksPort = socksPort;
  this.pidFile   = pidFile;
  this.wip       = {};
  this.strikes   = 0;
  this.locked    = false;
}

TorWrapper.prototype.connect = function () {
  var thisTor = this;
  var wrapperSocket = this.wrapperSocket = zmq.socket('dealer');
  wrapperSocket.identity = 'wrapperSocket_pid' + process.pid + "_socks" + this.socksPort;
  wrapperSocket.connect(config.topology.workServer);
  winston.info(wrapperSocket.identity + ' connected to workServer!');

  var message = JSON.stringify({headers: {type: 'connect'}, body: null});
  wrapperSocket.send(message);

  wrapperSocket.on('message', function(data) {
    var message = utils.readMessage(data);
    if (message.headers.type !== 'ping') winston.info(wrapperSocket.identity + " received this message = " + JSON.stringify(message));
    switch (message.headers.type) {
      case 'connected':
        var message = JSON.stringify({headers: {type: 'identity', topic: 'getWorkFromCache'}, body: null});
        wrapperSocket.send(message);
        winston.info(wrapperSocket.identity + " sent " + message);
        break;
      case 'ping':
        setTimeout(function() {
          wrapperSocket.send(utils.ping());
        }, 1000);
        break;
      case 'broadcast':
        if (message.headers.topic === 'workAddedToCache') {
          if (thisTor.isUnlocked()) {
            if (thisTor.wipIsNotFull()) {
              var message = JSON.stringify({headers: {type: 'identity', topic: 'getWorkFromCache'}, body: null});
              wrapperSocket.send(message); // workServer
            }
          }
        }
        break;
      case 'identity':
        if (message.headers.topic === 'workFromCache') {
          if (thisTor.isUnlocked()) {
            if (thisTor.wipIsNotFull()) {
              var work = message.body;
              thisTor.addWorkToWip(work);
              thisTor.startDl(work);
              winston.info("STATE of " + thisTor.socksPort + " => Todo: " + Object.size(thisTor.todo) + " WIP: " + Object.size(thisTor.wip));
            } else {
              var reply = JSON.stringify({headers: {type: 'identity', topic: 'returnWorkUnfinished', reason: "wipFull"}, body: message.body});
              wrapperSocket.send(reply); // workServer
            }
          } else {
            var reply = JSON.stringify({headers: {type: 'identity', topic: 'returnWorkUnfinished', reason: "tor locked"}, body: message.body});
            wrapperSocket.send(reply); // workServer
          }
        }
        break;
    }
  });
}

TorWrapper.prototype.isUnlocked = function () {
  return !this.locked;
}

TorWrapper.prototype.wipIsNotFull = function () {
  var notFull;
  if (Object.size(this.wip) < config.maxWipPerTor) {
    notFull = true;
  } else {
    notFull = false;
  }
  return notFull;
}

TorWrapper.prototype.addWorkToWip = function (work) {
  this.wip[work.id] = work;
}

TorWrapper.prototype.startDl = function (unclonedWork) {
  var that = this;
  (function () {
    var work        = clone(unclonedWork);
    var httpOptions = tor.createHttpOptions(that.socksPort, work.url);
    var s3Options   = tor.createS3Options(work.bucket, work.filename);
    
    winston.info("startDl() at " + Date.now() + " on " + that.socksPort + " requesting " + work.url);
    tor.makeRequestAndStreamGzippedResponseToS3(httpOptions, s3Options, function (response) {
      that.handleResponse(work, response);
    });
  })();
}

TorWrapper.prototype.handleResponse = function (work, response) {
  winston.info("handleResponse() at " + Date.now() + " on " + this.socksPort + " response from " + work.url);
  if (response.error === null && this.isUnlocked() === true) {
    var finishedWork = {  id                 : work.id
                        , ingress_coupling_id: work.ingress_coupling_id
                        , egress_coupling_id : work.egress_coupling_id
                        , statusCode         : response.results.statusCode
                        , headers            : response.results.headers
                        , instanceName       : config.instanceName
                        , socksPort          : this.socksPort };
    this.workDone(finishedWork);
  } else {
    this.workFailed(work);    
  }
}

TorWrapper.prototype.workDone = function (work) {
  this.deleteWorkFromWip(work);
  var message = JSON.stringify({headers: {type: 'identity', topic: 'workDone'}, body: work});
  this.wrapperSocket.send(message);
  winston.info(this.wrapperSocket.identity + " sent " + message);
}

TorWrapper.prototype.deleteWorkFromWip = function (work) {
  delete this.wip[work.id];
}

TorWrapper.prototype.workFailed = function (work) {
  this.setLock();
  this.deleteWorkFromWip(work);
  var message = JSON.stringify({headers: {type: 'identity', topic: 'workFailed'}, body: work});
  this.wrapperSocket.send(message);
  winston.info(this.wrapperSocket.identity + " sent " + message);

  if (this.wipIsEmpty() === true) {
    overlord.autoRecover(this);
  }
}

TorWrapper.prototype.setLock = function () {
  this.locked = true;
}

TorWrapper.prototype.wipIsEmpty = function () {
  var empty = false
  if (Object.size(this.wip) === 0) {
    empty = true;
  }
  return empty;
}

TorWrapper.prototype.unlock = function () {
  this.locked = false;
}

TorWrapper.prototype.addStrike = function () {
  this.strikes += 1;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////// Initialize ////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var overlord  = new Overlord();
var workCache = new utils.WorkCache();

if (process.argv[2] === 'init') {
  exports.init();
} else {
  winston.info("Must call as '$ node app init'");
  process.exit(0);
}