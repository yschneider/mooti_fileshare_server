//Express module
var express = require('express');           

//creates an Express application. The express() funciton is a top-level function exported by the express module.
var app = express();

// libsodium crytpo magic
var sodium = require('sodium').api;

var bodyParser = require('body-parser');                
var http = require('http');
var https = require('https');
var request = require('request');
var logger = require("./utils/logger");
var mysql = require('mysql');
var uuid = require('node-uuid');
var MongoClient = require('mongodb').MongoClient
    , assert = require('assert');

// the websocket
var WebSocket = require('ws');


var fs = require('fs');


var connections = {};
var count = 0;


//these parameters are needed to connect to DB; used by almost every route
var dbUser = "mootiadmin";
var dbPassword = "DevPassword$1";
var db = "mooti";
var dbhost ="mootidev.c5yxa5wex9tp.us-west-1.rds.amazonaws.com";


var MONGODBHOST = "54.67.113.149";

// configure app to use bodyParser(); this will let us get the data from a POST
app.use(bodyParser.json({limit: '50mb'}));

// disable caching for all calls
app.use(function (req, res, next) {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    res.header('Content-type', 'application/json');
    res.header('charset', 'utf-8')
    next()
});


var server = http.createServer(app);
var wss = new WebSocket.Server({ server });


/*
// generate our set of keys for this server
// used to generate the keys for the file

var serverKeys = sodium.crypto_box_keypair();
var secretKey = serverKeys.secretKey;
var publicKey = serverKeys.publicKey;

console.log('SecretKey =' + new Buffer(secretKey, 'binary').toString('base64'));
console.log('PublicKey = ' + new Buffer(publicKey, 'binary').toString('base64'));


var keys = {
    "secretkey": new Buffer(secretKey, 'binary').toString('base64'),
    "publicKey": new Buffer(publicKey, 'binary').toString('base64')
};

var readKeys = function(){
    // And then, to read it...
    keys = require("./filename.json");
    console.log('file == ' + JSON.stringify(keys));
};
console.log('writing');
fs.writeFile( "filename.json", JSON.stringify( keys ), "utf8", readKeys );
console.log('done');
*/



var keys = require("./filename.json");


wss.on('connection', function connection(ws, req) {
    //const location = url.parse(req.url, true);
    // You might use location.query.access_token to authenticate or share sessions
    // or req.headers.cookie (see http://stackoverflow.com/a/16395220/151312)

    count++

    console.log('connection established count = ' + count);
    connections[count] =  ws;



    console.log('Connections ==> ' + count);

    ws.on('message', function incoming(message) {
        console.log('received: %s', message);


        var data = JSON.parse(message);
        console.log('client type = ' + data.clientType);
        if(data.clientType == 'browser'){

            var requestType = data.requestType;
            // login request qrcode
            if(requestType == 'login') {

                var browserKeyPair = sodium.crypto_box_keypair();
                var browserSecretKey = browserKeyPair.secretKey;
                var browserPublicKey = browserKeyPair.publicKey;

                var browserKeys = {
                    "secretkey": new Buffer(browserSecretKey, 'binary').toString('base64'),
                    "publicKey": new Buffer(browserPublicKey, 'binary').toString('base64')
                };
                connections['keys' + count] = browserKeys;

                // this is a request from a browser
                // get the type of request being sent
                var outgoingMessage;
                var requestType = data.requestType;


                // this is a login request so there are no keys yet assgined to this browser session
                outgoingMessage = {
                    'requestType': 'login',
                    'secret': 'login' + count,
                    'session': browserKeys.publicKey,
                    "host": "localhost:8000",
                    'connectionID': count
                };


                console.log('Sending ' + outgoingMessage + ' to connection id = ' + count);
                connections[count].send(JSON.stringify(outgoingMessage));
            }
            else if(requestType == 'newFolder'){
                //{"clientType":"browser","requestType":"newFolder","folderName":"yadaFolder","browserId":"1","clientId":"e/7uOgt07U3WfOPENWLvjZxT01u8BPAz/NfP1ysQ2XY=","callback_id":1}
                var browserId = data.browserId;
                var clientId = data.clientId;
                var folderName = data.folderName;


                var message = {newFolder: {folderID: folderName}};


                var plainText = Buffer.from(JSON.stringify(message));
                var nonce = Buffer.allocUnsafe(sodium.crypto_box_NONCEBYTES);
                sodium.randombytes_buf(nonce);

                //var cipherMsg = sodium.crypto_box(plainText, nonce, new Buffer(keys.publicKey, 'base64'), new Buffer(keys.secretkey, 'base64'))

                //console.log("cipher text ==" + cipherMsg)


                var cipherMsg = sodium.crypto_box(plainText, nonce, new Buffer(clientId, 'base64'), new Buffer(keys.secretkey, 'base64'));

                console.log('Cipher Message = ' + cipherMsg);
                var encodedMessage = new Buffer(cipherMsg.slice(16), 'binary').toString('base64');
                //var encodedMessage = Buffer.from(cipherMsg, 0, cipherMsg.length).toString('base64');


                console.log('encoded message = ' + encodedMessage);



                var responseMessage = {'clientToClient':{'sender': keys.publicKey, 'message': encodedMessage, 'nonce':new Buffer(nonce, 'binary').toString('base64')}};

                console.log('sending: ' + JSON.stringify(responseMessage));
                connections[clientId].send(JSON.stringify(responseMessage));


            }
        }
        else
        {
            //{"clientToServerSender":{"message":"lnbudTZ9J4izeVZt6UlHrn3msvSotEBLeYpUvcx5tN7Oclr9FNsl88IMryHs3RuY3VKsW7JZ+VggidEl41UipkwAecXI2cA=","nonce":"7hs9lczaQpey7eJPzENu2jPppLphHaEw","sender":"tmtuGZ9nlhNlrLHulLVlTXPruoOj47DPlmtP1BeisV4="}}
            var clientToServerSender = data.clientToServerSender;
            if(clientToServerSender != undefined){
                var nonce = new Buffer(clientToServerSender.nonce, 'base64');
                var senderPubkey = new Buffer(clientToServerSender.sender, 'base64');
                var message = new Buffer(clientToServerSender.message, 'base64');



                // once we have pubkey, we will use this to identify the websocket connection

                console.log("Message == " + new Buffer(clientToServerSender.message, 'base64'));
                connections[clientToServerSender.sender] = ws;

                var plainMessage = sodium.crypto_box_open(Buffer.concat([Buffer.alloc(16), message], 16+message.length),nonce,senderPubkey, new Buffer(keys.secretkey, 'base64'));

                var response = JSON.parse(plainMessage);


                var filledIdRequest = response.filledIdRequest;
                if(filledIdRequest != undefined){
                    var secret = filledIdRequest.secret;
                    if(secret.indexOf('login') !== -1){
                        var browserId = secret.substr(5, 1);  // this only supports 9 connections refactor later



                        // send a message to the broswer that the user has logged in
                        connections[browserId].send(JSON.stringify({message:"user logged in", connectionId: browserId, clientId: clientToServerSender.sender}));

                        var plainText = Buffer.from('"success"');
                        nonce = Buffer.allocUnsafe(sodium.crypto_box_NONCEBYTES);
                        sodium.randombytes_buf(nonce);

                        //var cipherMsg = sodium.crypto_box(plainText, nonce, new Buffer(keys.publicKey, 'base64'), new Buffer(keys.secretkey, 'base64'))

                        //console.log("cipher text ==" + cipherMsg);


                        var cipherMsg = sodium.crypto_box(plainText, nonce, senderPubkey, new Buffer(keys.secretkey, 'base64'));

                        console.log('Cipther Message = ' + cipherMsg);
                        var encodedMessage = new Buffer(cipherMsg.slice(16), 'binary').toString('base64');
                        //var encodedMessage = Buffer.from(cipherMsg, 0, cipherMsg.length).toString('base64');


                        console.log('encoded message = ' + encodedMessage);



                        var responseMessage = {'serverToClient':{'message': encodedMessage, 'nonce':new Buffer(nonce, 'binary').toString('base64')}};

                        console.log('sending: ' + JSON.stringify(responseMessage));
                        ws.send(JSON.stringify(responseMessage));




                    }
                }
                console.log('Decrypted Message == ' + plainMessage)

            }

            var clientToClient = data.clientToClient;
            if(clientToClient != undefined){
                var nonce = new Buffer(clientToClient.nonce, 'base64');
                var senderPubkey = new Buffer(clientToClient.sender, 'base64');
                var message = new Buffer(clientToClient.message, 'base64');


                var browserkeys = connections['keys' + 1];

                var plainMessage = sodium.crypto_box_open(Buffer.concat([Buffer.alloc(16), message], 16+message.length),nonce,senderPubkey, new Buffer(browserkeys.secretkey, 'base64'));

                console.log("Recevied message = " + plainMessage);
                var response = JSON.parse(plainMessage);

                var folderCreate = {message: 'Folder Created!!'};
                var connection = connections[1];
                connection.send(JSON.stringify(folderCreate));


            }

            var clientToServer = data.clientToServer;
            if(clientToServer != undefined){
                console.log('ignoring this message');
                /*
                var nonce = new Buffer(clientToServer.nonce, 'base64');
                var senderPubkey = new Buffer(clientToServer.sender, 'base64');
                var message = new Buffer(clientToServer.message, 'base64');


                var plainMessage = sodium.crypto_box_open(Buffer.concat([Buffer.alloc(16), message], 16+message.length),nonce,senderPubkey, new Buffer(keys.secretkey, 'base64'));

                console.log("Recevied message = " + plainMessage);
                var response = JSON.parse(plainMessage);
                */
            }
        }
    });

    //ws.send('something');
});

server.listen(8080, function listening() {
    console.log('Listening on %d', server.address().port);
});

// Pseudo config, because we don't use real config files; would be too easy obviously
var port = process.env.PORT || 8383;        // set our port

// get an instance of the express Router object
var router = express.Router();   


// ROUTES FOR OUR API
// =============================================================================

// test route to make sure everything is working (accessed at GET http://localhost:8080/)
router.get('/', function (req, res) {
    //this route does not require any parameters as input
    res.json({message: 'MOOTI API SERVER'});
});


//create post method for route '/pubkey'
router.route('/pubkey').post(function (req, res) {

    res.send(keys.publicKey);

});



//create post method for route '/getVersion'
router.route('/sendMessage').post(function (req, res) {
    var senderPubKey = req.body.senderPubKey;
    var receiverPubkey = req.body.receiverPubkey;
    var cipherText = req.body.cipherText;
    var ciphterTextLength = req.body.cipherTextLength;
    var nonce = req.body.nonce;


    // connect to mooti db
    // Connection URL
    var url = 'mongodb://' + MONGODBHOST + ':27017/mooti';

// Use connect method to connect to the server
    MongoClient.connect(url, function(err, db) {

        if(err == null) {
            console.log("Connected successfully to server");
        }
        else{
            res.json({classname : 'sendMessage', status :'FAILURE', message : 'DB connection error ' +  err});
        }

        var users = db.collection('users');

        var user = {};

        res.json({status : 'success'});
        db.close();
    });




});




// MOEDA Service
//create post method for route '/createUser'
router.route('/createUser').post(function (req, res) {

    console.log('Received: ' + JSON.stringify(req.body));
    var pubKey = req.body.pubKey;
    var email = req.body.email;
    var pin = req.body.pin;

    // connect to mooti db
    // Connection URL
    var url = 'mongodb://' + MONGODBHOST + ':27017/mooti';

// Use connect method to connect to the server
    MongoClient.connect(url, function(err, db) {

        if(err == null) {
            console.log("Connected successfully to server");
            // set the collection
            var users = db.collection('users');

            // create the document
            var user = {pubKey: pubKey, email :email, pin : pin};
            users.insertOne(user, function(err, r){
                if(err == null){
                    res.json({status : 'success'});
                    return;
                }
                else{
                    res.json({classname : 'createUser', status :'FAILURE', message : 'insert failed ' +  err});
                }

            });
        }
        else{
            res.json({classname : 'createUser', status :'FAILURE', message : 'DB connection error ' +  err});
        }


        db.close();
    });
});





// REGISTER OUR ROUTES -------------------------------
// all of our routes will be prefixed with /api
app.use('/', router);

// START THE SERVER
// =============================================================================
app.listen(port);
logger.info('Server running on port ' + port);

