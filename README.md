ScaleTor
========

Scale Tor clusters over AWS for handling distributed anonymous requests

#### API Usage

~~~~~~~~~~~~REQUEST~~~~~~~~~~~~~
{
    'id'                 : <String> must be unique across entire system (e.g. id + table name)
  , 'ingress_coupling_id': <int> 
  , 'egress_coupling_id' : <int>
  , 'url'                : <String>
  , 'storageOptions'     : <Object>
}

~~~~~~~~~~~~RESPONSE~~~~~~~~~~~~
{
    id                   : <int>
  , 'ingress_coupling_id': <int> 
  , 'egress_coupling_id' : <int>
  , statusCode           : <int>
  , headers              : <String> <JSON>
  , instanceName         : <String> <JSON>
  , socksPort            : <int> (Optional)
}