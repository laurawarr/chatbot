"use strict";

//// SETUP //////

const bodyParser = require('body-parser');
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const request = require('request');

let Wit = null;
let log = null;
try {
  // if running from repo
  Wit = require('../').Wit;
  log = require('../').log;
} catch (e) {
  Wit = require('node-wit').Wit;
  log = require('node-wit').log;
}

// Optional. You will see this name in eg. 'ps' or 'top' command
process.title = 'node-chat';

// Port where we'll run the websocket server
var webSocketsServerPort = 1338;

// websocket and http servers
var webSocketServer = require('websocket').server;
var http = require('http');

/**
 * Global variables
 */
// list of currently connected clients (users)
var clients = [ ];

var sessions = {};
var globalId = 0;


function S4() {
    return (((1+Math.random())*0x10000)|0).toString(16).substring(1); 
}
 
function createGUID(){
  // then to call it, plus stitch in '4' in the third group
  var guid = (S4() + S4() + "-" + S4() + "-4" + S4().substr(0,3) + "-" + S4() + "-" + S4() + S4() + S4()).toLowerCase();
  return guid;
}


//////// WIT CODE ////////

const firstEntityValue = (entities, entity) => {
  const val = entities && entities[entity] &&
    Array.isArray(entities[entity]) &&
    entities[entity].length > 0 &&
    entities[entity][0].value
  ;
  if (!val) {
    return null;
  }
  return typeof val === 'object' ? val.value : val;
};

// Our bot actions
const actions = {
  send(conn, {text}) {
    // Our bot has something to say!
    // Let's retrieve the Facebook user whose session belongs to
    const recipient = sessions[conn.sessionId];
    if (recipient) {
      // Yay, we found our recipient!
      var obj = {
        time: (new Date()).getTime(),
        text: text,
        author: "Dexter",
        color: "#000"
      };

      var json = JSON.stringify({ type:'message', data: obj });
      try { 
        recipient.sendUTF(json) 

      } catch (err) {
        console.error(
          'Oops! An error occurred while forwarding the response to',
          recipient,
          ':',
          err.stack || err
        );
      };
    } else {
      console.error('Oops! Couldn\'t find user for session:', sessionId);
      // Giving the wheel back to our bot
      return Promise.resolve()
    }
  },
  getForecast({context, entities}) {
    var location = firstEntityValue(entities, 'location');
    if (location) {
      context.forecast = 'sunny in ' + location; // we should call a weather API here
      delete context.missingLocation;
    } else {
      context.missingLocation = true;
      delete context.forecast;
    }
    return context;
  },
};

// Setting up our bot
const wit = new Wit({
  accessToken: "YGMZWPVND7FLCAIQ4HAIYZA2XE2VBNVB",
  actions,
  logger: new log.Logger(log.INFO)
});


//////// CHAT CODE ///////////

/**
 * Helper function for escaping input strings
 */
function htmlEntities(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Array with some colors
var colors = [ 'red', 'green', 'blue', 'magenta', 'purple', 'plum', 'orange' ];
// ... in random order
colors.sort(function(a,b) { return Math.random() > 0.5; } );

/**
 * HTTP server
 */
var server = http.createServer(function(request, response) {
    // Not important for us. We're writing WebSocket server, not HTTP server
});
server.listen(webSocketsServerPort, function() {
    console.log((new Date()) + " Server is listening on port " + webSocketsServerPort);
});

/**
 * WebSocket server
 */
var wsServer = new webSocketServer({
    // WebSocket server is tied to a HTTP server. WebSocket request is just
    // an enhanced HTTP request. For more info http://tools.ietf.org/html/rfc6455#page-6
    httpServer: server
});

// This callback function is called every time someone
// tries to connect to the WebSocket server
wsServer.on('request', function(request) {
    console.log((new Date()) + ' Connection from origin ' + request.origin + '.');

    // accept connection - you should check 'request.origin' to make sure that
    // client is connecting from your website
    // (http://en.wikipedia.org/wiki/Same_origin_policy)
    var connection = request.accept(null, request.origin); 
    // we need to know client index to remove them on 'close' event
    var index = clients.push(connection) - 1;
    connection.context = {};
    var sessionId = createGUID();
    // connection.sessionId = guid;
    sessions[sessionId] = connection;

    var userName = false;
    var userColor = false;

    console.log((new Date()) + ' Connection accepted.');

    // user sent some message
    connection.on('message', function(message) {
        if (message.type === 'utf8') { // accept only text
            if (userName === false) { // first message sent by user is their name
                // remember user name
                userName = htmlEntities(message.utf8Data);
        
                // get random color and send it back to the user
                userColor = colors.shift();
                connection.sendUTF(JSON.stringify({ type:'color', data: userColor }));
                console.log((new Date()) + ' User is known as: ' + userName
                            + ' with ' + userColor + ' color.');

            } else { // log and broadcast the message
                console.log((new Date()) + ' Received Message from '
                            + userName + ': ' + message.utf8Data);

                var obj = {
                    time: (new Date()).getTime(),
                    text: htmlEntities(message.utf8Data),
                    author: userName,
                    color: userColor
                };

                // send user's message to current client
                var json = JSON.stringify({ type:'message', data: obj });
                connection.sendUTF(json);

                // Process what user has said:
                console.log(sessionId)
                wit.runActions(
                  sessionId, // the user's current session
                  message.utf8Data, // the user's message
                  connection.context // the user's current session state
                ).then((context) => {
                  // Our bot did everything it has to do.
                  // Now it's waiting for further messages to proceed.
                  console.log('Waiting for next user messages');
                  // Updating the user's current session state
                  connection.context = context;
                })
                .catch((err) => {
                  console.error('Oops! Got an error from Wit: ', err.stack || err);
                })
               
            }
        }
    });

    // user disconnected
    connection.on('close', function(connection) {
        console.log((new Date()) + " Peer "
            + connection.remoteAddress + " disconnected.");
        // remove user from the list of connected clients
        // clients.splice(index, 1);
        // for (var i=0; i < clients.length; i++) {
        //     if ( clients[i].connected == false ){
        //         clients.splice(i, 1);
        //         for (var j = i; j < clients.length; j++){
        //             clients[j].index--;
        //         }
        //         return;
        //     }
        // }
        console.log('connection closed')
    });

});