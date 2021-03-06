'use strict';

var ade = require('./js/ade');

const ConversationV1 = require('watson-developer-cloud/conversation/v1');
const redis = require('redis');

var express = require('express');
var app = express();
//var port = process.env.PORT || 8080;
var port = 3000;
var bodyParser = require('body-parser');

require('dotenv').config();

app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

// Using some globals for now
let conversation;
let redisClient;
let context;
let Wresponse;

function errorResponse(reason) {
	return {
	  version: '1.0',
	  response: {
		shouldEndSession: true,
		outputSpeech: {
		  type: 'PlainText',
		  text: reason || 'An unexpected error occurred. Please try again later.'
		}
	  }
	};
  }

function initClients() {
	return new Promise(function(resolve, reject) {
	// Connect a client to Watson Conversation
	conversation = new ConversationV1({
		password: process.env.WCS_Password,
        username: process.env.WCS_Username,
		version_date: '2016-09-20'
	});
	console.log('Connected to Watson Conversation');
  
	  // Connect a client to Redis 
	  redisClient = redis.createClient(process.env.redis_port, process.env.redis_url);
	  redisClient.auth(process.env.redis_auth, function (err) {
		if (err) throw err;
	});
	redisClient.on('connect', function() {
		console.log('Connected to Redis');
	});
	resolve("Done");
  });
  }

function conversationMessage(request, workspaceId) {
	return new Promise(function(resolve, reject) {
	  const input = request.inputs[0] ? request.inputs[0].rawInputs[0].query : 'start skill';
		var test = {
			input: { text: input },
			workspace_id: workspaceId,
			context: context
			//context: {}
		  };
	  //console.log("Input" + JSON.stringify(test,null,2));
	  conversation.message(
		{
		  input: { text: input },
		  workspace_id: workspaceId,
		  context: context
		},
		function(err, watsonResponse) {
		  if (err) {
			console.error(err);
			reject('Error talking to Watson.');
		  } else {
			//console.log(watsonResponse);
			context = watsonResponse.context; // Update global context			
			resolve(watsonResponse);
		  }
		}
	  );
	});
  }

function getSessionContext(sessionId) {
	//console.log('sessionId: ' + sessionId); 
	return new Promise(function(resolve, reject) {
	  redisClient.get(sessionId, function(err, value) {
		if (err) {
		  console.error(err);
		  reject('Error getting context from Redis.');
		}
		// set global context
		context = value ? JSON.parse(value) : {};
		//console.log('---------');
		//console.log('Context Recupéré:');
		//console.log(context);
		//console.log('---------');
		resolve();
	  });
	});
  }
  
  function saveSessionContext(sessionId) {
		//console.log('---------');
		//console.log('Begin saveSessionContext ' + sessionId);
  
	// Save the context in Redis. Can do this after resolve(response).
	if (context) {
	  const newContextString = JSON.stringify(context);
	  // Saved context will expire in 600 secs.
	  redisClient.set(sessionId, newContextString, 'EX', 600);
	  //console.log('Saved context in Redis');
	  //console.log(sessionId);
		//console.log(newContextString);
		//console.log('---------');
	}
  }

function sendResponse(response, resolve) {

		//response = traiterCoursMaintenant(response);
		//response = traiterGetProfMaintenant(response);
		response = traiterCoursDate(response);
		response = prochainCours(response);
		response = prochainExamen(response);

		response.context.action = null;
		console.log(response);
	
	  // Combine the output messages into one message.
	  const output = response.output.text.join(' ');
	  var resp = {
		conversationToken: null,
		expectUserResponse: true,
		expectedInputs: [
			{
				inputPrompt: {
					richInitialPrompt: {
						items: [
							{
								simpleResponse: {
									textToSpeech: output,
									displayText: output
								}
							}
						],
						suggestions: []
					}
				},
				possibleIntents: [
					{
						intent: 'actions.intent.TEXT'
					}
				]
			}
		]
	};
	
	Wresponse =  resp;
	// Resolve the main promise now that we have our response
	resolve(resp);
	}

app.post('/api/google4IBM', function(args, res) {
	return new Promise(function(resolve, reject) {
	  const request = args.body;
	  //console.log("Google Home is calling");
	  //console.log(JSON.stringify(request,null,2));
	  const sessionId = args.body.conversation.conversationId;
	  initClients()
	  .then(() => getSessionContext(sessionId))
	  .then(() => conversationMessage(request, process.env.workspace_id))
	  .then(actionResponse => sendResponse(actionResponse, resolve))
	  .then(data => {
		res.setHeader('Content-Type', 'application/json');
		res.append("Google-Assistant-API-Version", "v2");
		res.json(Wresponse);
	})
	.then(() => saveSessionContext(sessionId))    
	.catch(function (err) {
		console.error('Erreur !');
		console.dir(err);
	});
	});
  });

/*
	res.setHeader('Content-Type', 'application/json')
	res.append("Google-Assistant-API-Version", "v2")
*/



function traiterCoursMaintenant(response){
	const intent = response.intents[0].intent;
	console.log("intent : " + intent);
	if(intent === 'cours_maintenant' && response.context.context_formation != undefined){
		var arr = ade.edtJour(response.context.context_formation, ade.getSysDate());
		if(arr.length > 0){
			var res = "";
			for(var i=0; i < arr.length; i++){
				res += arr[i].intitule + " à " + arr[i].hdebut + " en salle " + arr[i].lieu + ", ";
			}
			response.output.text[0] = res;
		}else{
			response.output.text[0] = "Vous n'avez aucun cour";
		}
	}

	return response;
}



function traiterGetProfMaintenant(response){
	//const intent = reponse.intents[0].intent;
	//console.log("intent : " + intent);
	if (response.context.action === 'prof_cours_maintenant' && response.context.context_formation != undefined){
		var arr = ade.getProf(ade.getSysDate, ade.getSysHeure);
		if(arr.length > 0){
			var res = "Actuellement tu as cours avec ";
			for(var i=0; i < arr.length; i++){
				res += arr[i] + ", ";
			}
			response.output.text[0] = res;
		}else{
			response.output.text[0] = "Vous n'avez aucun cour";
		}
		
	}
	
	return response;
	
}


function prochainCours(response){
	if(response.context.action === 'prochain_prof' && response.context.context_formation != undefined){
		var res = ade.prochainCours(response.context.context_formation);
		console.log(res);
		if(res != null && res != undefined){
			response.output.text[0] = "Votre prochain cours sera à " + res.hdebut + " en " + res.lieu + ". " + res.intitule + " avec " + res.enseignant;
		}else{
			response.output.text[0] = "Vous n'avez pas de cours prévu";
		}
	}

	return response;
}


function prochainExamen(response){
	if(response.context.action === 'prochain_examen' && response.context.context_formation != undefined){
		var res = ade.prochainExamen(response.context.context_formation);
		console.log(res);
		if(res != null && res != undefined){
			response.output.text[0] = "Votre prochain examen sera à " + res.hdebut + " en " + res.lieu + ". " + res.intitule + " avec " + res.enseignant;
		}else{
			response.output.text[0] = "Vous n'avez pas d'examen prévu";
		}
	}

	return response;
}


function traiterCoursDate(response){
	//const intent = response.intents[0].intent;
	//console.log("intent : " + intent);
	if (response.context.action === 'cours_date' && response.context.context_formation != undefined && response.context.date != undefined){
		const date = new Date(response.context.date);
		const dateF = date.getDate()+"/"+ade.convertMonth(date.getMonth()+1)+"/"+date.getFullYear();
		console.log("date : " + date);
		console.log("dateF : " + dateF);
		var arr = ade.edtJour(response.context.context_formation, dateF);
		console.log('array : ' + arr);
		if(arr.length > 0){
			var res = "Vous aurez cours de ";
			for(var i=0; i < arr.length; i++){
				res += arr[i].intitule + " à " + arr[i].hdebut + " en " + arr[i].lieu + ", ";
			}
			response.output.text[0] = res;
		}
	}

	return response;
}




// start the server
app.listen(port);
console.log('Server started! At http://localhost:' + port);