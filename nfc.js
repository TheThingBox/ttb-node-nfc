/*
    Copyright (c) 2016 Digital Airways (www.DigitalAirways.com)
    This work is free. You can redistribute it and/or modify it under the
    terms of the "Do What The Fuck You Want To" Public License, Version 2,
    as published by Sam Hocevar. 
    See http://www.wtfpl.net for more details.
*/

module.exports = function(RED) {
    "use strict";

    var events = require("events");
    var Serialport = require("serialport");

    var EffInnovNFC = {
    	port: "",
        serachForPort : "EFT-NFCMD-USB",
    	baud: 115200,
    	databits: 8,
    	parity: "none",
    	stopbits: 1,
        _emitter: new events.EventEmitter(),
        serial: null,
        buffer: null,
        tout:100,
        timer:null,
        cpt:0,
        _waitForScdOK: false,
        _closing: false,
        _open:false,
        _listen:false,
        _lastInfosRead: null,
        _lastIDRead: null,
        _ask:{
        	asking:false,
        	_task:["listen","stop","getInfos","getIsNDEF","readNDEF","waitForOk","none"],
        	task:"none",
        	getCurrentTask: function(){
        		return EffInnovNFC._ask.task;
        	},
        	setTask:function(t){
        		if(t && EffInnovNFC._ask._task.indexOf(t) != -1){
        			EffInnovNFC._ask.task = t;
        			EffInnovNFC._ask.asking = true;

        		} else {
        			EffInnovNFC._ask.task = "none";
        			EffInnovNFC._ask.asking = false;
        		}
        	}
        },
        on: function(a,b) { 
        	EffInnovNFC._emitter.on(a,b);
        },
        close: function(cb) {
        	if(!EffInnovNFC._closing){
                EffInnovNFC._closing = true;
                
				EffInnovNFC.write("AT+SSP=0\r\n",function(err,res) {
                    EffInnovNFC.timer = null;
                    EffInnovNFC.buffer = null;
                    EffInnovNFC.cpt = 0;
                    try {
                        EffInnovNFC.serial.close(function(){
                            RED.log.info("serial port closed");
                            EffInnovNFC._open = false;
                            EffInnovNFC._closing = false;
                            cb();
                        });
                    }
                    catch(err) {cb();}

                    try {
                        EffInnovNFC._emitter.removeAllListeners("error");
                        EffInnovNFC._emitter.removeAllListeners("closed");
                        EffInnovNFC._emitter.removeAllListeners("connected");
                        EffInnovNFC._emitter.removeAllListeners("data");
                        EffInnovNFC._emitter.removeAllListeners("listenning");
                        EffInnovNFC._emitter.removeAllListeners("reading");
                    } catch(e){}
                });
            }
        },
        write: function(m,cb) {
            try {
                EffInnovNFC.serial.write(m,cb);
            } catch(err){
                cb(err);
            }
        },
        connect:function(cb){
            if(!EffInnovNFC._open){
                Serialport.list(function(errList,data){
                    if (!errList){                        
                        EffInnovNFC.port = getDevPath(data,EffInnovNFC.serachForPort);
                    } else {
                        EffInnovNFC.port = "/dev/ttyUSB-EFFINNOV-NFC";
                    }
                    EffInnovNFC.serial = new Serialport(
                    	EffInnovNFC.port,
                    	{
                            baudRate: EffInnovNFC.baud,
                            dataBits: EffInnovNFC.databits,
                            parity: EffInnovNFC.parity,
                            stopBits: EffInnovNFC.stopbits,
                            parser: Serialport.parsers.raw,
                            autoOpen: true
                        },
                        function(err, results) {
                        	if (err) {
                        		EffInnovNFC.serial.emit('error',err);
                                setTimeout(function(){
                                    EffInnovNFC.connect(function(errCo){
                                        if (!errCo){
                                            EffInnovNFC.ask("listen",function(){});
                                        }
                                    });
                                },5000);
                        	} else{
                                EffInnovNFC.buffer = new Buffer(4096);
                                EffInnovNFC.cpt = 0;
                                EffInnovNFC.timer = null;
                        		EffInnovNFC._open = true;
                        	}
                            if (cb){
                                cb(err);
                            }
                        }
                    );
                    EffInnovNFC.serial.on('error', function(err) {
                        EffInnovNFC._emitter.emit('closed');
                    });
                    EffInnovNFC.serial.on('close', function() {
                        EffInnovNFC._open = false;
                        if (!EffInnovNFC._closing) {
                            setTimeout(function(){
                                EffInnovNFC.connect(function(errCo){
                                    if (!errCo){
                                        EffInnovNFC.ask("listen",function(){});
                                    }
                                });
                            },5000);
                        }
                        EffInnovNFC._emitter.emit('closed');
                    });
                    EffInnovNFC.serial.on('open',function() {
                        RED.log.info("serial port for NFC dongle is open");
                        EffInnovNFC._emitter.emit('connected');
                    });
                    EffInnovNFC.serial.on('data',function(d) {
                        if(EffInnovNFC._closing || !EffInnovNFC._open){
                            return;
                        }

                        for (var z=0; z<d.length; z++) {
                            if (EffInnovNFC.timer) {
                                EffInnovNFC.cpt += 1;
                                EffInnovNFC.buffer[EffInnovNFC.cpt] = d[z];
                            }
                            else {
                                EffInnovNFC.timer = setTimeout(function () {                                    
                                    EffInnovNFC.timer = null;
                                    if(EffInnovNFC._closing || !EffInnovNFC._open){
                                        return;
                                    }
                                    
                                    var m = new Buffer(EffInnovNFC.cpt+1);
                                    EffInnovNFC.buffer.copy(m,0,0,EffInnovNFC.cpt+1);
                                    m = m.toString().split("\u0000\n");
                                    m = m.join('').split("\r\n");
                                    var am = [];
                                    for (var i = 0, size = m.length; i<size ; i++){
                                        if(m[i] != ""){
                                            am.push(m[i]);
                                        }
                                    }
                                    EffInnovNFC.completeTask(am,function(res){
                                        if(res){
                                            EffInnovNFC._emitter.emit('data',res);
                                        }
                                        m = null;
                                    });
                                }, EffInnovNFC.tout);
                                EffInnovNFC.cpt = 0;
                                EffInnovNFC.buffer[0] = d;
                            }
                        }
                    });
                    EffInnovNFC.serial.on("disconnect",function() {
                        RED.log.info("serial port for NFC dongle is gone away");
                    });
                });
            } else if (cb){
                cb();
            }
        },
        isConnected: function(){
        	return EffInnovNFC._open;
        },
        isListenning: function(){
            return EffInnovNFC._listen;
        },
        ask:function(task,callback){
        	EffInnovNFC._ask.setTask(task);
        	if(callback){
        		EffInnovNFC.runTask(task,callback);
        	}
        },
        runTask:function(task,callback){
        	switch(task){
        		case EffInnovNFC._ask._task[0] : //listen
            		EffInnovNFC.write("AT+SNFCI=1\r\n",function() {
                        setTimeout(function(){
                            EffInnovNFC.write("AT+SSP=1 "+EffInnovNFC.tout+"\r\n",function() {
                                EffInnovNFC._listen = true;
                                callback();
                            });
                        },500);
            			
	            	});
        			break;
        		case EffInnovNFC._ask._task[1] : //stop
            		EffInnovNFC.write("AT+SSP=0\r\n",function() {
                        EffInnovNFC._listen = false;
            			callback();
            		});
        			break;
        		default:
        			EffInnovNFC._ask.setTask();
        			break;
        	}
        },
        completeTask:function(mess,callback){
        	if(EffInnovNFC._ask.asking){
        		switch(EffInnovNFC._ask.task){
        			case EffInnovNFC._ask._task[0] : //listen
        				if ( (mess.length >= 2 && mess[0] == "OK" && mess[1] == "OK") || (EffInnovNFC._waitForScdOK &&  mess.length == 1 && mess[0] == "OK") ){
                            EffInnovNFC._waitForScdOK = false;
        					EffInnovNFC._ask.setTask();
        					callback();
                            EffInnovNFC._emitter.emit('listenning');
        				} else if (mess.length >= 2 && mess[0] == "ERROR:1" || mess[1] == "ERROR:1") { 
                            EffInnovNFC._waitForScdOK = false; 
                            EffInnovNFC.write("AT+SNFCI=0\r\n",function() {                          
                                callback();
                                EffInnovNFC._ask.setTask();
                                setTimeout(function(){
                                    EffInnovNFC.ask("listen",function(){});
                                },500);
                            });
                        } else if (mess.length == 1) {
                            if (mess[0] == "ERROR:1"){
                                EffInnovNFC.write("AT+SNFCI=0\r\n",function() {
                                    EffInnovNFC._ask.setTask();
                                    setTimeout(function(){
                                        EffInnovNFC.ask("listen",callback);
                                    },500)
                                });
                            } else if (mess[0] == "OK"){
                                EffInnovNFC._waitForScdOK = true;
                                EffInnovNFC.ask("listen",callback);
                            }
                        }


        				break;
        			case EffInnovNFC._ask._task[1] : //stop
        				if (mess.length >= 1 && mess[0] == "OK"){
        					EffInnovNFC._ask.setTask();
        					callback();
                            EffInnovNFC._emitter.emit('connected');
        				}
        				break;
        			case EffInnovNFC._ask._task[2] : //getInfos
        				if (mess.length >= 1){
        					var rep = mess[0].split(" ");
        					EffInnovNFC._lastInfosRead = {};
        					EffInnovNFC._lastInfosRead.type = rep[0].split(":")[1]
        					switch(EffInnovNFC._lastInfosRead.type){
        						case "TIT": // JewelTopaz
                                    EffInnovNFC._lastIDRead = rep[1];
        							EffInnovNFC._lastInfosRead.UID = rep[1];
        							EffInnovNFC._lastInfosRead.ATQA = rep[2];
        							EffInnovNFC._lastInfosRead.SAK =rep[3];
        							break;
        						case "TB": // ISO 14443B
                                    EffInnovNFC._lastIDRead = rep[1];
        							EffInnovNFC._lastInfosRead.PUPI = rep[1];
        							EffInnovNFC._lastInfosRead.AppData =rep[2];
        							EffInnovNFC._lastInfosRead.ProtocolInfo =rep[3];
        							break;
        						case "T3T": //Felicia tag
                                    EffInnovNFC._lastIDRead = rep[1];
        							EffInnovNFC._lastInfosRead.NFCID = rep[1];
        							EffInnovNFC._lastInfosRead.SystemCode = rep[2];
        							break;
        						case "T5T": // ISO 15693
                                    EffInnovNFC._lastIDRead = rep[1];
        							EffInnovNFC._lastInfosRead.UID = rep[1];
        							EffInnovNFC._lastInfosRead.AFI = rep[2];
        							EffInnovNFC._lastInfosRead.DSFID = rep[3];
        							EffInnovNFC._lastInfosRead.ResponseFlag = rep[4];
        							EffInnovNFC._lastInfosRead.ICRef = rep[5];
        							break;
        						case "T4AT": // ISO 14443-4A
                                    EffInnovNFC._lastIDRead = rep[1];
        							EffInnovNFC._lastInfosRead.UID = rep[1];
        							EffInnovNFC._lastInfosRead.ATQA = rep[2];
        							EffInnovNFC._lastInfosRead.SAK =rep[3];
        							break;
        						case "T4BT": // ISO 14443-4B
                                    EffInnovNFC._lastIDRead = rep[1];
        							EffInnovNFC._lastInfosRead.PUPI = rep[1];
        							EffInnovNFC._lastInfosRead.AppData =rep[2];
        							EffInnovNFC._lastInfosRead.ProtocolInfo =rep[3];
        							break;
        						case "TMC": // Mifare Classic tag
                                    EffInnovNFC._lastIDRead = rep[1];
        							EffInnovNFC._lastInfosRead.UID = rep[1];
        							EffInnovNFC._lastInfosRead.ATQA = rep[2];
        							EffInnovNFC._lastInfosRead.SAK =rep[3];
        							break;
        						case "T2T": // Mifare Ultralight tag or equivalent
                                    EffInnovNFC._lastIDRead = rep[1];
        							EffInnovNFC._lastInfosRead.UID = rep[1];
        							EffInnovNFC._lastInfosRead.ATQA = rep[2];
        							EffInnovNFC._lastInfosRead.SAK =rep[3];
        							break;
        					}
        				}
        				if(mess.length == 3 && (mess[1] == "+RDRMV" || mess[2] == "+RDRMV")){
        					EffInnovNFC._ask.setTask();         					
        					callback({
                                "payload":EffInnovNFC._lastIDRead,
        						"message":"Tag detected",
        						"tagInfos":EffInnovNFC._lastInfosRead,
        						"intent":2
        					});
        					EffInnovNFC._lastInfosRead = null;
                            EffInnovNFC._lastIDRead = null;
        					callback({"message":"Tag removed","intent":3});
                            EffInnovNFC._emitter.emit('listenning');
        				} else {
            				EffInnovNFC._ask.setTask("getIsNDEF");
            				EffInnovNFC.write("AT+TISNDEF?\r\n",function(err,res){});
            				callback();
            			}
        				break;
        			case EffInnovNFC._ask._task[3] : //getIsNDEF
        				if (mess.length >= 2 && (mess[0] == "+RDRMV" || mess[1] == "+RDRMV")){
        					EffInnovNFC._ask.setTask();         					
        					callback({
                                "payload":EffInnovNFC._lastIDRead,
        						"message":"Tag detected",
        						"tagInfos":EffInnovNFC._lastInfosRead,
        						"intent":2
        					});
        					EffInnovNFC._lastInfosRead = null;
                            EffInnovNFC._lastIDRead = null;
        					callback({"message":"Tag removed","intent":3});
                            EffInnovNFC._emitter.emit('listenning');
        				} else if (mess.length >= 1 && mess[0] == "ERROR:11"){
        					EffInnovNFC._ask.setTask();
        					callback({
                                "payload":EffInnovNFC._lastIDRead,
        						"message":"Tag detected",
        						"tagInfos":EffInnovNFC._lastInfosRead,
        						"intent":2
        					});
        					EffInnovNFC._lastInfosRead = null;
                            EffInnovNFC._lastIDRead = null;
                            EffInnovNFC._emitter.emit('listenning');
        				} else {
        					EffInnovNFC._ask.setTask("readNDEF");      					
            				EffInnovNFC.write("AT+NDEFR?\r\n",function(err,res){});            				
            				callback();
        				}
        				break;
        			case EffInnovNFC._ask._task[4] : //readNDEF
        				if (mess.length >= 1){
        					EffInnovNFC._ask.setTask();
        					callback({
                                "payload":EffInnovNFC._lastIDRead,
        						"message":"Tag detected",
        						"tagInfos":EffInnovNFC._lastInfosRead,
        						"intent":2,
        						"NDEF":mess[0].split(":")[1]
        					});
        					EffInnovNFC._lastInfosRead = null;
                            EffInnovNFC._lastIDRead = null;
                            EffInnovNFC._emitter.emit('listenning');
        				}
        				break;
        			case EffInnovNFC._ask._task[5] : //waitForOk
        				break;
        			default : 				 //none         
        				EffInnovNFC._ask.setTask();   				
        				callback({"payload":mess});
        				break;
        		}
        	}else{
        		if(mess.length >= 2 && mess[0] == "+TAGDSC" && mess[1] == "+RDRMV"){
        			callback({"message":"Tag detected, but removed too fast for reading content"});
        		} else if(mess.length >= 1 && mess[0] == "+TAGDSC"){
        			EffInnovNFC._ask.setTask("getInfos");
        			EffInnovNFC.write("AT+TINFO?\r\n",function(err,res){});
                    EffInnovNFC._emitter.emit('reading');
        		} else if(mess.length >= 1 && mess[0] == "+RDRMV"){
        			callback({"message":"Tag removed","intent":3});
                    EffInnovNFC._emitter.emit('listenning');
        		}
        	}
        }
    }

    var status = {
        connected : {fill:"green",shape:"dot",text:"connected"},
        disconnected : {fill:"red",shape:"dot",text:"disconnected"},
        listen : {fill:"green",shape:"ring",text:"listen"},
        reading :{fill:"grey",shape:"ring",text:"reading"}
    }

    function nfc(n) {
        RED.nodes.createNode(this, n);
        this.idonly = n.idonly;
        var node = this;
        
        node.status(status.disconnected);

        EffInnovNFC.on("data",function(d) {
            if(node.idonly == true && d.hasOwnProperty("payload")){
                node.send({payload:d.payload});
            } else {
                node.send(d);
            }
        });

        EffInnovNFC.on("closed",function() {
            node.status(status.disconnected);
        });
        EffInnovNFC.on("connected",function() {
            node.status(status.connected);            
        });

        EffInnovNFC.on("reading",function() {
            node.status(status.reading);
        });

        EffInnovNFC.on("listenning",function() {
            node.status(status.listen);
        });

        if (EffInnovNFC.isConnected()) {
            if (EffInnovNFC.isListenning()) {
                node.status(status.listen);
            } else {
                node.status(status.connected);                
                setTimeout(function(){
                    EffInnovNFC.ask("listen",function(){});
                },1000);    
            }        
        } else {
            EffInnovNFC.connect(function(err){
                if (!err){
                    setTimeout(function(){
                        EffInnovNFC.ask("listen",function(){});
                    },500);
                }
            });
        }

        this.on("input", function(msg) {
            if(!EffInnovNFC.isConnected()){
                RED.log.info("The NFC dongle is not connected")
                return;
            }
            var intent = msg.intent;
            if(typeof intent !== "undefined" && intent != null && intent !== "") {
                if(intent == 0) {
                    EffInnovNFC.ask("stop",function(){});
                } else if (intent == 1) {
                    EffInnovNFC.ask("listen",function(){});
                }
            }
        });

        this.on('close', function(done) {
            if (EffInnovNFC.isConnected()) {
            	EffInnovNFC.close(done);
            } else {
            	done();
            }
        });
    }
    RED.nodes.registerType("nfc", nfc);

    function getDevPath(data, search){
        for (var device in data){
            for (var item in data[device]){
                if (data[device][item] && data[device][item].indexOf(search) != -1){
                    return data[device].comName;
                }
            }
        }
        return search;
    }
}