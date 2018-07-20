var XMLUtil = Packages.com.glide.util.XMLUtil;
var g_probe=null;

var vRealizeJS = Class.create();
var SUCCESS = Packages.com.service_now.mid.probe.tpcon.OperationStatusType.SUCCESS;
var FAILURE = Packages.com.service_now.mid.probe.tpcon.OperationStatusType.FAILURE;
var Event   = Packages.com.snc.commons.eventmgmt.Event;
var SNEventSenderProvider = Packages.com.service_now.mid.probe.event.SNEventSenderProvider;
var HTTPRequest = Packages.com.glide.communications.HTTPRequest;

var MAX_EVENTS_TO_FETCH = 3000;
var DAYS_BACK_AT_FIRST_RUN = 14; // for the first init

var GUEST_IP = "guest_ip_address";
var HOST_IP = "ip_address";
var MAC = "mac_address";
var RESOURCE_NAME = "resourceName";
var errorMessage = "";

vRealizeJS.prototype = Object.extendsObject(AProbe, {

	// test the connection with vRealize server 
    testConnection : function() {

		ms.log("vRealize testing connection");
		 
		var retVal = {};
 		var query = '/suite-api/api/alerts?page=0&pageSize=3';
		var response = this.getResponse(query);
		if (response == null){
			retVal['status']  = FAILURE.toString();
			retVal['error_message'] = errorMessage;
			return retVal;
		}
		ms.log('vRealizeJS Connector Test Connection response:' + response);		 
		ms.log('result:' + response.getStatusCode());
		if (response.getStatusCode() === 200){
			retVal['status']  = SUCCESS.toString();
		}
		else{
			retVal['status']  = FAILURE.toString();
			this.addError('vRealizeJS Connector Test Connection response code: ' + response.getStatusCode());
		}
		if (retVal['status'] === FAILURE.toString())
			retVal['error_message'] = errorMessage;
		return retVal;

		
	},
	


	execute: function() {

		ms.log("vRealizeJS Connector: execute connection ...");
				
		var retVal = {};
			
		var lastSignature = this.probe.getParameter("last_event");
		
		var events = this.getEvents(lastSignature);
		if (events == null) {
			retVal['status'] = FAILURE.toString();
			retVal['error_message'] = errorMessage;
			return retVal;
		}

		// send all events			
		var sender = SNEventSenderProvider.getEventSender();
		for (var i = 0; i< events.length; i++) {	
			// comment out the debug log. revert it only for debug needs 
			// ms.log("vRealize connector. Sending event: " + events[i]);
			sender.sendEvent(events[i]);
		}

		retVal['status'] = SUCCESS.toString();
		if (events.length > 0) {
			// the result is sorted, but the sort order can differ. Therefore 
			// the last signature is either on the first or the last event
			var lastEventSignature = events[0].getField("alertTimeStamp");
			var firstEventSignature = events[events.length-1].getField("alertTimeStamp");
			
			if (firstEventSignature >= lastEventSignature)
				retVal['last_event'] = firstEventSignature;
			else 
				retVal['last_event'] = lastEventSignature;
		}
		
		ms.log("vRealizeJS Connector: sent " + events.length + 
			   " events. Return to instance: status="+retVal['status'] + 
			   "  lastDiscoverySignature=" + retVal['last_event'] );
		
		return retVal;
    },

	createRequest: function(query) {
		var username =  this.probe.getParameter("username");
		var password =  this.probe.getParameter("password");
		var host =  this.probe.getParameter("host").trim();
		var protocol = this.probe.getAdditionalParameter("protocol").trim();
		var port = this.probe.getAdditionalParameter("port").trim();
		
		if (port && (''+port).trim().length) {
			host = host + ":" + port;
		}
		
		var url = protocol+ "://" + host + query;	
		ms.log("vRealizeJS Connector: URL is " + url);
		var request = new HTTPRequest(url);
		request.setBasicAuth(username, password);
		return request;
	},
	
	getResponse: function(query) {
		var request = this.createRequest(query);
		var response = request.get();
		if (response == null)
			this.addError(request.getErrorMessage());
		return response;
	},
	
	
	getResponseFromQuery: function(startTime) {
		

		var query = '/suite-api/api/alerts/query?pageSize=-1';
	  
		var xmlString = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><ops:alert-query compositeOperator="AND" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ops="http://webservice.vmware.com/vRealizeOpsMgr/1.0/"><ops:startTimeRange><ops:startTime>'+startTime+'</ops:startTime></ops:startTimeRange></ops:alert-query>';
		var request = this.createRequest(query);
		request.addHeader('Content-Type','application/xml');
		request.addHeader('Accept','application/xml');
		var response;
		try{
			response = request.post(xmlString);
		} catch(e){
			this.addError("Request failed: " + e);
		}
		if (response == null)
			this.addError(request.getErrorMessage());
		return response;
	},
	
	addToResourceMap: function(resourceMap, resId)
	{
		var resourceData = {};
		var url = '/suite-api/api/resources/'+resId + '/properties';	
		var obj = this.requestResource(url);
		
		// Format of the responce:
		// <ops:property name="config|name">vCenter_Hyperic_Server</ops:property>
		// <ops:property name="net:4000|ip_address">10.196.39.141</ops:property>
		// <ops:property name="net:4000|mac_address">00:50:56:80:47:22</ops:property>
		// <ops:property name="summary|guest|ipAddress">10.196.39.141</ops:property>

		var properties = obj['ops:property'];
		for (var i = 0; i < properties.length; i++) {

			if (properties[i]['@name'].indexOf("ip_address") >= 0)
				resourceData[HOST_IP] = properties[i]['#text'];
			else if (properties[i]['@name'] === "summary|guest|ipAddress")
				resourceData[GUEST_IP] = properties[i]['#text'];
			else if (properties[i]['@name'].indexOf("mac_address") >= 0)
				resourceData[MAC] = properties[i]['#text'];
			else if (properties[i]['@name'] === "config|name")
				resourceData[RESOURCE_NAME] = properties[i]['#text'];
		}

		url = '/suite-api/api/resources/'+resId;	
		obj = this.requestResource(url);

		// Format of the responce:
		// <ops:resourceKey>
		// <ops:resourceKindKey>VirtualMachine</ops:resourceKindKey>
		var resourceKind = obj['ops:resourceKey']['ops:resourceKindKey'];
		if (resourceKind != null)
			resourceData['resourceKind'] = resourceKind;


		resourceMap[resId] = resourceData;
	},
		
	requestResource: function(url)
	{
		var response = this.getResponse(url);
		var xmlString=response.getBody();
		var helper = new XMLHelper(xmlString);
		return helper.toObject();
	},

	exptractNodeFromProperties: function(resourceData)
	{
		// node is defined by guest ip or host it or mac or resource name (in this order)
		var node = "";
		if (resourceData[GUEST_IP])
			node = resourceData[GUEST_IP];
		else if (resourceData[HOST_IP])
			node = resourceData[HOST_IP];
		else if (resourceData[MAC])
			node = resourceData[MAC];
		else if (resourceData[RESOURCE_NAME])
			node = resourceData[RESOURCE_NAME];

			
		return node;
	},
				
	getEvents: function(latestTimestamp) 
	{
		var myDate = new Date(); 
		var myEpoch = myDate.getTime();
		// for first run (if there is no last signature get last 2 weeks of events) else bump up time to avoid getting latest event
		if (latestTimestamp === null)
			//latestTimestamp = 0;
			latestTimestamp = myEpoch - DAYS_BACK_AT_FIRST_RUN * 24 * 3600 * 1000;
		else
			latestTimestamp++;
		

		var query = this.getResponseFromQuery(latestTimestamp);
		if (query == null)
			return null;
		var xmlString=query.getBody();
		var helper = new XMLHelper(xmlString);
		var obj = helper.toObject();
		
		var xmlevents = obj['ops:alert'];
		
		if ((xmlevents.length ===null) && (xmlevents))
			xmlevents = [xmlevents];
		var alertDefinitions = {};
		var resourcesMap = {};
		var emsName =  this.probe.getParameter("connector_name");
		var events = [];
        for (var i=0; i<xmlevents.length; i++) {
			var event = Event();
			var xmlalert = xmlevents[i];
			resId = xmlalert['ops:resourceId'];	
			resKey = xmlalert['ops:resourceId'];
			alertDefinition = xmlalert['ops:alertDefinitionId'];
			
			// get resource properties
			if (!resourcesMap[resId])
				this.addToResourceMap(resourcesMap,resId);

			var resourceData = resourcesMap[resId];
			event.setField("node", this.exptractNodeFromProperties(resourceData));
			if (resourceData[RESOURCE_NAME])
				event.setField("resource", resourceData[RESOURCE_NAME]);

			// all resource properties are going to additional info			
			for (var key in resourceData) {
  				if (resourceData.hasOwnProperty(key)) 
  					event.setField(key, resourceData[key]);
			}

			event.setField("description", xmlalert['ops:alertDefinitionName']);
			event.setField("Criticality  ", xmlalert['ops:alertLevel']);
			var type = xmlalert['ops:alertDefinitionId'].replace("AlertDefinition-VMWARE-","");
  			event.setField("type", type);
			event.setField("metric_name", type);
 			event.setField("alertID ", xmlalert['ops:alertId']);
			
			var severity=(xmlalert['ops:alertLevel']);
			event.setField("severity", this.mapSeverity(severity));
			
			event.setSource("vRealize");
            event.setEmsSystem(emsName);
			event.setField("alertTimeStamp", xmlalert['ops:startTimeUTC']);
			event.setField("AlertType ", xmlalert['ops:type']);
			event.setField("AlertSubType ", xmlalert['ops:subType']);
			event.setResolutionState("New");
			// date starts at 0 to calculate the epoch time of each event.
			var d = new Date(0);
			d.setUTCSeconds(xmlalert['ops:startTimeUTC']/1000);
			// yyyy-MM-dd HH:mm:ss
			var year = "" + d.getUTCFullYear();
			var month = "" + (d.getUTCMonth() + 1); if (month.length == 1) { month = "0" + month; }
			var day = "" + d.getUTCDate(); if (day.length == 1) { day = "0" + day; }
			var hour = "" + d.getUTCHours(); if (hour.length == 1) { hour = "0" + hour; }
			var minute = "" + d.getUTCMinutes(); if (minute.length == 1) { minute = "0" + minute; }
			var second = "" + d.getUTCSeconds(); if (second.length == 1) { second = "0" + second; }
			var dateString = year + '-' + month + '-' +  day + ' ' + hour + ':' + minute + ':' + second;
			event.setField("Time of the alert: ", (dateString));
			event.setTimeOfEvent(dateString);
			
			events[i] = event;

         }
		return events;
	},	
	
	
	mapSeverity: function(severity) {
		var mappedSeverity = 5; //  info
		if (severity==='IMMEDIATE')
			mappedSeverity = 2;
		else if (severity==='CRITICAL')
			mappedSeverity = 1;
		else if (severity==='WARNING')
			mappedSeverity = 3;
		else if (severity==='INFORMATION')
			mappedSeverity = 5;
		return mappedSeverity;
			
	},
	addError : function(message){
		if (errorMessage === "")
			errorMessage = message;
		else
			errorMessage += "\n" + message;
		ms.log(message);
	},
    type: "vRealizeJS"
});
