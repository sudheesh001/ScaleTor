
////////////////////////////////////
/// ZEROMQ NETWORK TOPOLOGY FILE ///
////////////////////////////////////

exports.development = {
    upstream      : 'tcp://127.0.0.1:PORT'
  , downstream    : 'tcp://127.0.0.1:PORT'
  , workServer    : 'tcp://127.0.0.1:PORT'
  , pipelineServer: 'tcp://127.0.0.1:PORT'
  , overlord      : 'ipc://tmp/overlord/0'
  , dashboard     : 'tcp://127.0.0.1:PORT'
}

exports.production = {
    upstream      : 'tcp://PRODUCTION-IP-ADDR:PORT'
  , downstream    : 'tcp://PRODUCTION-IP-ADDR:PORT'
  , workServer    : 'tcp://PRODUCTION-IP-ADDR:PORT'
  , pipelineServer: 'tcp://PRODUCTION-IP-ADDR:PORT'
  , overlord      : 'ipc://tmp/overlord/0'
  , dashboard     : 'tcp://PRODUCTION-IP-ADDR:PORT'
}