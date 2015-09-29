var memwatch = require('memwatch');

memwatch.on('leak', function(info) { 
  console.log("Leak event");
  console.log(info);
});

memwatch.on('stats', function(stats) { 
  console.log("Stats event");
  console.log(stats);
});

function LeakingClass() {

}

var leaks = [];
setInterval(function() {
  for (var i = 0; i < 100000000; i++) {
    leaks.push(new LeakingClass);
  }

  console.error('Leaks: %d', leaks.length);
}, 1);