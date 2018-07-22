var XMLUtil = Packages.com.glide.util.XMLUtil;
var g_probe=null;

var JunosSpaceJS = Class.create();
var SUCCESS = Packages.com.service_now.mid.probe.tpcon.OperationStatusType.SUCCESS;
var FAILURE = Packages.com.service_now.mid.probe.tpcon.OperationStatusType.FAILURE;
var Event   = Packages.com.snc.commons.eventmgmt.Event;
var SNEventSenderProvider = Packages.com.service_now.mid.probe.event.SNEventSenderProvider;
var HTTPRequest = Packages.com.glide.communications.HTTPRequest;

var MAX_EVENTS_TO_FETCH = 3000;
var DAYS_BACK_AT_FIRST_RUN = 14; // for the first init
var errorMessage = "";


JunosSpaceJS.prototype = Object.extendsObject(AProbe, {
	
	// test the connection with the Junos Space Server
	testConnection : function() {
		
		ms.log("JunosSpaceJS testing connection");
		
		var query = this.getQueryForTestConnection(query);
		ms.log("JunosSpaceJS testConnection query: " + query);

		var retVal = {};

		try {
		var response = this.getResponse(query);
		if (response == null){
			retVal['status']  = FAILURE.toString();
			retVal['error_message'] = errorMessage;
			return retVal;
		}

		ms.log('JunosSpaceJS Connector Testing Connection response:' + response.getBody());		 
		ms.log('result:' + response.getStatusCode());

		if (response.getStatusCode() === 200){
			retVal['status']  = SUCCESS.toString();
		}
		else{
			retVal['status']  = FAILURE.toString();
			this.addError('JunosSpaceJS Connector Test Connection response code: ' + response.getStatusCode());
		}
		if (retVal['status'] === FAILURE.toString())
			retVal['error_message'] = errorMessage;
		return retVal;

	} catch (e) {
		this.addError("Failed to connect to JunosSpace");
		this.addError(e);
		retVal['status'] = FAILURE.toString();
		retVal['error_message'] = errorMessage;
	}
		
	},



execute: function() {
	
	ms.log("JunosSpaceJS Connector Connector: execute connection ...");
	
	var retVal = {};
	
	var resultArray = this.getResult(this.getQueryForExecute()); //retrieve all events from the target montior
	
	var events = this.getSNEvents(resultArray); //convert raw events to SN events
	if (events == null) {
		retVal['status'] = FAILURE.toString();
		retVal['error_message'] = errorMessage;
		return retVal;
	}
	
	// send all events
	var sender = SNEventSenderProvider.getEventSender();
	var i = 0;
	var successFlag = true;
	for (; i< events.length; i++) {
		if (events[i]) {
			successFlag = successFlag && sender.sendEvent(events[i]); //send each event
		}
	}
	
	if (successFlag) {
		retVal['status'] = SUCCESS.toString();
		if (events.length > 0) {
			this.updateLastSignature(events, retVal); //if all events were sent successfuly, update last signature
		}
	} else {
		retVal['status'] = FAILURE.toString();
		return retVal;
	}
	
	ms.log("JunosSpaceJS Connector: sent " + events.length +
	" events. Return to instance: status="+retVal['status'] +
	"  lastDiscoverySignature=" + retVal['last_event'] );
	
	return retVal;
},

updateLastSignature: function(events, retVal) {
	var timeOfEvent = this.getEventTimestampFieldName();
	
	//get lastEventSignature, for example: var lastEventSignature = events[0].getField(timeOfEvent);
	
	retVal['last_event'] = lastEventSignature; //update last signature timestamp
},

getEventTimestampFieldName : function () { //return the name of event timestamp field
return "";
},

getSNEvents: function(resultArray) {
	if (resultArray == null)
		return null;
	
	var events = [];
	
	// if no events were found, return
	if (resultArray.results.length === 0)
		return events;
	
	
	// cache all requierd maps with additional information for events
	
	var latestTimestamp = this.probe.getParameter("last_event");
	var i = 0;
	for (; i<resultArray.results.length; i++) {
		
		var event = this.createSNEvent(resultArray.results[i]); //pass also cached information if possible, for example eventTypes
		// filter out events on first pull
		if (!this.filterEvent(latestTimestamp, event)) {
			events.push(event);
		}
	}
	
	return events;
},

createSNEvent : function (rawEvent) { //get all cached information as well
var event = Event();

var emsName =  this.probe.getParameter("connector_name");
event.setEmsSystem(emsName); //set the connector instance name as source instance
event.setSource("JunosSpace"); 

//set all event fields
event.setSeverity(""); //set severity value 1-critical to 4-warning
event.setHostAddress(""); // will be mapped to node field
event.setField("hostname", ""); //add additional info values

return event;
},

parseTimeOfEvent: function (sourceTime) { //parse the time of event to GMT using the following format: yyyy-MM-dd HH:mm:ss

return "";
},

//ignore closed and info events on first action of pulling
filterEvent : function (latestTimestamp, event) {
	if (latestTimestamp == null && event.isClosing())
		return true;
	return false;
},

getQueryForTestConnection : function () {
	var query = "/api/space/opennms/alarms?limit=1";
	return query;
},

getQueryForExecute : function () {
	
	var latestTimestamp = this.probe.getParameter("last_event");

	var query = "/opennms/rest2/alarms?" + "limit=" + MAX_EVENTS_TO_FETCH;
	//differ between first action of pulling and other
	if (latestTimestamp != null) {
		 //Junos Space Date Format: 2013-06-14T20:41:45
		query = query + "_s=lastEventTime=gt=" + latestTimestamp;
	} else {
		query = query + ""; //first cycle collection
	}
	
	return query;
},

getURL : function (host, query) {
	//var port =  this.probe.getAdditionalParameter("port"); //retrieve all additional parameters unique to this Source
	
	var port =  this.probe.getAdditionalParameter("port").trim();; //retrieve all additional parameters unique to this Source
	var protocol = this.probe.getAdditionalParameter("protocol").trim();

	var url = protocol + "://" + host + query;
	return url;
},


createRequest: function(query) {
	var username =  this.probe.getParameter("username");
	var password =  this.probe.getParameter("password");
	var host =  this.probe.getParameter("host").trim();
		
	var url = this.getURL(host, query);
	ms.log("JunosSpaceJS Connector: URL is " + url);
	var request = new HTTPRequest(url);
	request.setBasicAuth(username, password);
	return request;
	
	//return the suitable request. For example, use HTTP request:
	// var request = new HTTPRequest(url);
	// request.setBasicAuth(username, password);
	// return request;
},

getResponse: function(query) {
	//return parsed response according to the query type (such as REST or DB);
	
	// for example: return this.getResponseJSON(query);
	var request = this.createRequest(query);
	var response = request.get();
	if (response == null)
		this.addError(request.getErrorMessage());
	return response;
},

//helper method - creates HTTP request and returns the response as XML string
getResponseFromQuery: function(startTime) {
	var request = this.createRequest(query);

	var query = '/api/space/opennms/alarms?limit=1';

	request.addHeader('Content-Type','application/xml');
	request.addHeader('Accept','application/xml');
	var response = request.post(getXmlString());
	if (response == null)
		this.addError(request.getErrorMessage());
	return response;
},

getResult : function (query) {
	
	//Run the query
	
	if (false) { //validate the response
		this.addError("Connector: Failed to retrieve data");
	return null;
}

return response; // if needed, parse the response before returning. For example, can use parseToJson method

},



//helper method - creates HTTP request and returns the response as JSON string
getResponseJSON: function(query) {
	var request = this.createRequest(query);
	request.addHeader('Accept','application/json');
	var response = request.get();
	if (response == null)
		this.addError(request.getErrorMessage());
	return response;
},



//helper method - returns the suitable XML string
getXmlString: function() {
	var xmlString = "";
	return xmlString;
},

//helper method - returns the response after parsing it to JSON
parseToJSON : function (response) {
	var parser = new JSONParser();
	var resultJson =  parser.parse(response.getBody() );
	ms.log("Connector: Found " + resultJson.results.length + " records");
	return resultJson;
	
},

addError : function(message){
	if (errorMessage === "")
		errorMessage = message;
	else
		errorMessage += "\n" + message;
	ms.log(message);
},

	
type: "JunosSpaceJS"
});

