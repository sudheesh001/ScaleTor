var spawn         = require('child_process').spawn;
var path          = require('path');
var torDirectory  = path.resolve(__dirname, "data");
var pidsDirectory = torDirectory + '/pids/';
var fs            = require('fs');
var pids          = [];
var config        = require(__dirname + '/config');
var winston       = config.winston;

var killPids = function(pids) {
  for(var i = 0; i < pids.length; i++) {
    var pid = pids[i];
    winston.info("kill -9 on PID# " + pid);

    if (i !== (pids.length - 1)) {
      spawn('kill', ['-9', pid]);
    } else {
      var kill = spawn('kill', ['-9', pid]);
      kill.on('close', function (code) {
        winston.info("rm -rf on " + torDirectory);
        spawn('rm', ['-rf', torDirectory]);
      });
    }
  }
}

var fileReader = function(fileName, filesLength) {
  fs.readFile(pidsDirectory + fileName, function (err, data) {
    if (err) throw err;
    var pid = data.toString().replace(/(\r\n|\n|\r)/gm,"");
    pids.push(pid);
    if (pids.length == filesLength) {
      killPids(pids);
    }
  });
}

winston.info("Running teardown.js");
fs.readdir(pidsDirectory, function(err, files){
  if (files !== undefined && files.length > 0) {
    for (var i = 0; i < files.length; i++) {
      var fileName = files[i];
      fileReader(fileName, files.length);
    }    
  } else {
    winston.info("No pids in " + pidsDirectory);
    winston.info("rm -rf on " + torDirectory);
    spawn('rm', ['-rf', torDirectory]);
  }
});