const OPEN_REMOTE_SLOT = "-1";

// Keep track of attributes of remote camera sources:
// * max = maximum number of remote cameras to render; initialize to 5 but update as needed per resource manager recommendations.
// * count = total number of remote cameras that are streaming in the conference.
// * rendered = number of remote cameras that are locally rendered.
var remoteSources = { max: 5, count: 0, rendered: 0 }

// rendererSlots[0] is used to render the local camera;
// rendererSlots[1] through rendererSlots[4] are used to render up to 4 cameras from remote participants.
// rendererSlots[5] is used to render camera of active speaker.
// rendererSlots[S] is used to render remote share.
var rendererSlots = ["1", OPEN_REMOTE_SLOT, OPEN_REMOTE_SLOT, OPEN_REMOTE_SLOT, OPEN_REMOTE_SLOT, OPEN_REMOTE_SLOT];
var sharing = false;

// Run StartVidyoConnector when the VidyoClient is successfully loaded
function StartVidyoConnector(VC, configParams) {
    var vidyoConnector;
    var cameras = {};
    var microphones = {};
    var speakers = {};
    var selectedLocalCamera = {id: 0, camera: null};
    var cameraPrivacy = false;
    var microphonePrivacy = false;
    var remoteCameras = {};	

    console.log("Number of remote slots: " + configParams.numRemoteSlots);
    remoteSources.max = configParams.numRemoteSlots;

    window.onresize = function() {
        showRenderers(vidyoConnector);
    };
    
    window.onbeforeunload = function() {
        vidyoConnector.Destruct();
    }

    VC.CreateVidyoConnector({
        viewId: null, // Set to null in order to create a custom layout
        viewStyle: "VIDYO_CONNECTORVIEWSTYLE_Default",   // Visual style of the composited renderer
        remoteParticipants: configParams.numRemoteSlots, // Maximum number of participants to render
        logFileFilter: "warning info@VidyoClient info@VidyoConnector",
        logFileName:"",
        userData:""
    }).then(function(vc) {
        vidyoConnector = vc;

        // Don't display left panel if hideConfig is enabled.
        if (configParams.hideConfig=="1") {
            updateRenderers(vidyoConnector, true);
        }

        registerEventListeners(vidyoConnector, cameras, microphones, speakers, selectedLocalCamera, remoteCameras, configParams);
        handleDeviceChange(vidyoConnector, cameras, microphones, speakers);

        // Populate the connectionStatus with the client version
        vidyoConnector.GetVersion().then(function(version) {
            $("#clientVersion").html("v " + version);
        }).catch(function() {
            console.error("GetVersion failed");
        });

        // If enableDebug is configured then enable debugging
        if (configParams.enableDebug === "1") {
            vidyoConnector.EnableDebug({port:7776, logFilter: "warning info@VidyoClient info@VidyoConnector"}).then(function() {
                console.log("EnableDebug success");
            }).catch(function() {
                console.error("EnableDebug failed");
            });
        }

        // If running on Internet Explorer, set the default certificate authority list.
        // This is necessary when IE's Protected Mode is enabled.
        if (configParams.isIE) {
            vidyoConnector.SetCertificateAuthorityList({ certificateAuthorityList: "default" }).then(function() {
                console.log("SetCertificateAuthorityList success");
            }).catch(function() {
                console.error("SetCertificateAuthorityList failed");
            });
        }

        // Handle camera privacy and microphone privacy initial state
        if (configParams.cameraPrivacy === "1") {
           $("#cameraButton").click();
        }
        if (configParams.microphonePrivacy === "1") {
           $("#microphoneButton").click();
        }

        // Join the conference if the autoJoin URL parameter was enabled
        if (configParams.autoJoin === "1") {
          joinLeave();
        } else {
          // Handle the join in the toolbar button being clicked by the end user.
          $("#joinLeaveButton").one("click", joinLeave);
        }

        // Handle the camera privacy button, toggle between show and hide.
        $("#cameraButton").click(function() {
            // CameraPrivacy button clicked
            cameraPrivacy = !cameraPrivacy;
            vidyoConnector.SetCameraPrivacy({
                privacy: cameraPrivacy
            }).then(function() {
                if (cameraPrivacy) {
                    // Hide the local camera preview, which is in slot 0
                    $("#cameraButton").addClass("cameraOff").removeClass("cameraOn");
                    vidyoConnector.HideView({ viewId: "renderer0" }).then(function() {
                        console.log("HideView Success");
                    }).catch(function(e) {
                        console.log("HideView Failed");
                    });
                } else {
                    // Show the local camera preview, which is in slot 0
                    $("#cameraButton").addClass("cameraOn").removeClass("cameraOff");
                    vidyoConnector.AssignViewToLocalCamera({
                        viewId: "renderer0",
                        localCamera: selectedLocalCamera.camera,
                        displayCropped: configParams.localCameraDisplayCropped,
                        allowZoom: false
                    }).then(function() {
                        console.log("AssignViewToLocalCamera Success");
                        ShowRenderer(vidyoConnector, "renderer0");
                    }).catch(function(e) {
                        console.log("AssignViewToLocalCamera Failed");
                    });
                }
                console.log("SetCameraPrivacy Success");
            }).catch(function() {
                console.error("SetCameraPrivacy Failed");
            });
        });

        // Handle the microphone mute button, toggle between mute and unmute audio.
        $("#microphoneButton").click(function() {
            // MicrophonePrivacy button clicked
            microphonePrivacy = !microphonePrivacy;
            vidyoConnector.SetMicrophonePrivacy({
                privacy: microphonePrivacy
            }).then(function() {
                if (microphonePrivacy) {
                    $("#microphoneButton").addClass("microphoneOff").removeClass("microphoneOn");
                } else {
                    $("#microphoneButton").addClass("microphoneOn").removeClass("microphoneOff");
                }
                console.log("SetMicrophonePrivacy Success");
            }).catch(function() {
                console.error("SetMicrophonePrivacy Failed");
            });
        });

        function joinLeave() {
            // join or leave dependent on the joinLeaveButton, whether it
            // contains the class callStart or callEnd.
            if ($("#joinLeaveButton").hasClass("callStart")) {
                $("#connectionStatus").html("Connecting...");
                $("#joinLeaveButton").removeClass("callStart").addClass("callEnd");
                $('#joinLeaveButton').prop('title', 'Leave Conference');
                connectToConference(vidyoConnector, remoteCameras, configParams);
            } else {
                $("#connectionStatus").html("Disconnecting...");
                vidyoConnector.Disconnect().then(function() {
                    console.log("Disconnect Success");
                }).catch(function() {
                    console.error("Disconnect Failure");
                });
            }
            $("#joinLeaveButton").one("click", joinLeave);
        }

        $("#options").removeClass("optionsHide");
    }).catch(function(err) {
        console.error("CreateVidyoConnector Failed " + err);
    });
}

// Render a video in the div.
function ShowRenderer(vidyoConnector, divId) {
    var rndr = document.getElementById(divId);
    vidyoConnector.ShowViewAt({viewId: divId, x: rndr.offsetLeft, y: rndr.offsetTop, width: rndr.offsetWidth, height: rndr.offsetHeight});
	//vidyoConnector.ShowViewLabel({viewId:divId, showLabel:false});
}

// Find an open slot in the receive source slots (1 - 4)
function findOpenSlot() {
    // Scan through the renderer slots and look for an open slot.
    for (var i = 1; i < rendererSlots.length - 1; ++i) {
        if (rendererSlots[i] === OPEN_REMOTE_SLOT)
            return i;
    }
    return 0;
}

// Render a remote camera to a particular slot
function renderToSlot(vidyoConnector, remoteCameras, participantId, slot) {
    // Render the remote camera to the slot.
    rendererSlots[slot] = participantId;
    remoteCameras[participantId].isRendered = true;
	
	//Do not crop when rendering to Slot 5, only crop when rendering to other slots
	if (slot==5) {
		vidyoConnector.AssignViewToRemoteCamera({
			viewId: "renderer" + (slot),
			remoteCamera: remoteCameras[participantId].camera,
			displayCropped: false,
			allowZoom: false
		}).then(function(retValue) {
			console.log("AssignViewToRemoteCamera " + participantId + " to slot " + slot + " = " + retValue);
			ShowRenderer(vidyoConnector, "renderer" + (slot));
			++remoteSources.rendered;
		}).catch(function() {
			console.log("AssignViewToRemoteCamera Failed");
			rendererSlots[slot] = OPEN_REMOTE_SLOT;
			remoteCameras[participantId].isRendered = false;
		});
	}
	else{
		vidyoConnector.AssignViewToRemoteCamera({
			viewId: "renderer" + (slot),
			remoteCamera: remoteCameras[participantId].camera,
			displayCropped: true,
			allowZoom: false
		}).then(function(retValue) {
			console.log("AssignViewToRemoteCamera " + participantId + " to slot " + slot + " = " + retValue);
			ShowRenderer(vidyoConnector, "renderer" + (slot));
			++remoteSources.rendered;
		}).catch(function() {
			console.log("AssignViewToRemoteCamera Failed");
			rendererSlots[slot] = OPEN_REMOTE_SLOT;
			remoteCameras[participantId].isRendered = false;
		});	
			
	}
    
}

function registerEventListeners(vidyoConnector, cameras, microphones, speakers, selectedLocalCamera, remoteCameras, configParams) {
    // Map the "None" option (whose value is 0) in the camera, microphone, and speaker drop-down menus to null since
    // a null argument to SelectLocalCamera, SelectLocalMicrophone, and SelectLocalSpeaker releases the resource.
    cameras[0]     = null;
    microphones[0] = null;
    speakers[0]    = null;

    // Handle appearance and disappearance of camera devices in the system
    vidyoConnector.RegisterLocalCameraEventListener({
        onAdded: function(localCamera) {
            // New camera is available
            $("#cameras").append("<option value='" + window.btoa(localCamera.id) + "'>" + localCamera.name + "</option>");
            cameras[window.btoa(localCamera.id)] = localCamera;
			console.log("localCamera onAdded");
        },
        onRemoved: function(localCamera) {
            // Existing camera became unavailable
            $("#cameras option[value='" + window.btoa(localCamera.id) + "']").remove();
            delete cameras[window.btoa(localCamera.id)];

            // If the removed camera was the selected camera, then hide it
            if(selectedLocalCamera.id === localCamera.id) {
                vidyoConnector.HideView({ viewId: "renderer0" }).then(function() {
                    console.log("HideView Success");
                }).catch(function(e) {
                    console.log("HideView Failed");
                });
            }
        },
        onSelected: function(localCamera) {
            // Camera was selected/unselected by you or automatically
            if(localCamera) {
                $("#cameras option[value='" + window.btoa(localCamera.id) + "']").prop('selected', true);
                selectedLocalCamera.id = localCamera.id;
                selectedLocalCamera.camera = localCamera;
                // Assign view to selected camera
                vidyoConnector.AssignViewToLocalCamera({
                    viewId: "renderer0",
                    localCamera: localCamera,
                    displayCropped: configParams.localCameraDisplayCropped,
                    allowZoom: false
                }).then(function() {
                    console.log("AssignViewToLocalCamera Success");
                    ShowRenderer(vidyoConnector, "renderer0");
                }).catch(function(e) {
                    console.log("AssignViewToLocalCamera Failed");
                });
            } else {
                selectedLocalCamera.id = 0;
                selectedLocalCamera.camera = null;
            }
        },
        onStateUpdated: function(localCamera, state) {
            // Camera state was updated
        }
    }).then(function() {
        console.log("RegisterLocalCameraEventListener Success");
    }).catch(function() {
        console.error("RegisterLocalCameraEventListener Failed");
    });

    // Handle appearance and disappearance of microphone devices in the system
    vidyoConnector.RegisterLocalMicrophoneEventListener({
        onAdded: function(localMicrophone) {
            // New microphone is available
            $("#microphones").append("<option value='" + window.btoa(localMicrophone.id) + "'>" + localMicrophone.name + "</option>");
            microphones[window.btoa(localMicrophone.id)] = localMicrophone;
        },
        onRemoved: function(localMicrophone) {
            // Existing microphone became unavailable
            $("#microphones option[value='" + window.btoa(localMicrophone.id) + "']").remove();
            delete microphones[window.btoa(localMicrophone.id)];
        },
        onSelected: function(localMicrophone) {
            // Microphone was selected/unselected by you or automatically
            if(localMicrophone)
                $("#microphones option[value='" + window.btoa(localMicrophone.id) + "']").prop('selected', true);
        },
        onStateUpdated: function(localMicrophone, state) {
            // Microphone state was updated
        }
    }).then(function() {
        console.log("RegisterLocalMicrophoneEventListener Success");
    }).catch(function() {
        console.error("RegisterLocalMicrophoneEventListener Failed");
    });

    // Handle appearance and disappearance of speaker devices in the system
    vidyoConnector.RegisterLocalSpeakerEventListener({
        onAdded: function(localSpeaker) {
            // New speaker is available
            $("#speakers").append("<option value='" + window.btoa(localSpeaker.id) + "'>" + localSpeaker.name + "</option>");
            speakers[window.btoa(localSpeaker.id)] = localSpeaker;
        },
        onRemoved: function(localSpeaker) {
            // Existing speaker became unavailable
            $("#speakers option[value='" + window.btoa(localSpeaker.id) + "']").remove();
            delete speakers[window.btoa(localSpeaker.id)];
        },
        onSelected: function(localSpeaker) {
            // Speaker was selected/unselected by you or automatically
            if(localSpeaker)
                $("#speakers option[value='" + window.btoa(localSpeaker.id) + "']").prop('selected', true);
        },
        onStateUpdated: function(localSpeaker, state) {
            // Speaker state was updated
        }
    }).then(function() {
        console.log("RegisterLocalSpeakerEventListener Success");
    }).catch(function() {
        console.error("RegisterLocalSpeakerEventListener Failed");
    });

    vidyoConnector.RegisterRemoteCameraEventListener({
        onAdded: function(camera, participant) {
            // Store the remote camera for this participant
            remoteCameras[participant.id] = {camera: camera, isRendered: false};
            ++remoteSources.count; 
			console.log("remoteSources.count: " + remoteSources.count);
            // Check if resource manager allows for an additional source to be rendered.
            if (remoteSources.rendered < remoteSources.max) {
				//If there is only 1 remote participant, render to Slot 5
				if (remoteSources.count == 1) {
					renderToSlot(vidyoConnector, remoteCameras, participant.id, 5);
				}
				else {
					// If an open slot is found then assign it to the remote camera.
					var openSlot = findOpenSlot();
					if (openSlot > 0) {
						renderToSlot(vidyoConnector, remoteCameras, participant.id, openSlot);
					}
				}
            }
        },
        onRemoved: function(camera, participant) {
            console.log("RegisterRemoteCameraEventListener onRemoved participant.id : " + participant.id);
            delete remoteCameras[participant.id];
            --remoteSources.count; 

            // Scan through the renderer slots and if this participant's camera
            // is being rendered in a slot, then clear the slot and hide the camera.
            for (var i = 1; i < rendererSlots.length; i++) {
                if (rendererSlots[i] === participant.id) {
                    rendererSlots[i] = OPEN_REMOTE_SLOT;
                    console.log("Slot found, calling HideView on renderer" + i);
                    vidyoConnector.HideView({ viewId: "renderer" + (i) }).then(function() {
                        console.log("HideView Success");
                        --remoteSources.rendered;						
						
                        // If a remote camera is not rendered in a slot, replace it in the slot that was just cleared
                        for (var id in remoteCameras) {
                            if (!remoteCameras[id].isRendered) {
                                renderToSlot(vidyoConnector, remoteCameras, id, i);
                                break;
                            }
                        }
                    }).catch(function(e) {
                        console.log("HideView Failed");
                    });
                    break;
                }
            }			
        },
        onStateUpdated: function(camera, participant, state) {
            // Camera state was updated
        }
    }).then(function() {
        console.log("RegisterRemoteCameraEventListener Success");
    }).catch(function() {
        console.error("RegisterRemoteCameraEventListener Failed");
    });
	
	function swapTiles(slotA, slotB) {
		var participantIDA = rendererSlots[slotA];
		var participantIDB = rendererSlots[slotB];
		
		rendererSlots[slotA] = participantIDB;
		rendererSlots[slotB] = participantIDA;
		vidyoConnector.HideView({ viewId: "renderer" + slotA}).then(function() {
			console.log("swapTiles: HideView Success for " + "renderer" + slotA);
			--remoteSources.rendered;
			vidyoConnector.HideView({ viewId: "renderer" + slotB}).then(function() {
				console.log("swapTiles: HideView Success for " + "renderer" + slotB);
				--remoteSources.rendered;

				// Swap previous loudest speaker with new loudest speaker
				renderToSlot(vidyoConnector, remoteCameras, participantIDA, slotB);
				renderToSlot(vidyoConnector, remoteCameras, participantIDB, slotA);
		}).catch(function(e) {
			console.log("swapTiles: HideView Failed, loudest speaker not assigned");
		});
		}).catch(function(e) {
			console.log("swapTiles: HideView Failed, loudest speaker not assigned");
		});
	}

    vidyoConnector.RegisterParticipantEventListener({
        onJoined: function(participant) {
            getParticipantName(participant, function(name) {
                $("#participantStatus").html("" + name + " Joined");
                console.log("Participant onJoined: " + name);
            });
        },
        onLeft: function(participant) {
            getParticipantName(participant, function(name) {
                $("#participantStatus").html("" + name + " Left");
                console.log("Participant onLeft: " + name);
            });
        },
        onDynamicChanged: function(participants, cameras) {
            // Order of participants changed
        },
        onLoudestChanged: function(participant, audioOnly) {
            getParticipantName(participant, function(name) {
                $("#participantStatus").html("" + name + " Speaking");
            });

            // Consider switching loudest speaker tile if resource manager allows
            // for at least 1 remote source to be rendered.
            if (remoteSources.max > 0) {
                
                var found = false;
				
				// Check if the loudest speaker is being rendered in one of the slots
				for (var i = 1; i < rendererSlots.length; i++) {
					
                    if (rendererSlots[i] === participant.id) {
                        found = true;
						if (i != 5) {
							// Swap tiles only if the loudest speaker is not already in renderer5
							swapTiles(i,5);
						}
                        break;
                    }
                }
                console.log("onLoudestChanged: loudest speaker was in rendererSlots? " + i);

                // First check if the participant's camera has been added to the remoteCameras dictionary
                if (!(participant.id in remoteCameras)) {
                    console.log("Warning: loudest speaker participant does not have a camera in remoteCameras");
                }
                // If the loudest speaker is not being rendered in slot 5 then
                // hide the slot 5 remote camera and assign loudest speaker to slot 5.
                else if (!found) {
                    // Set the isRendered flag to false of the remote camera which is being hidden
					remoteCameras[rendererSlots[5]].isRendered = false;

                    // Hiding the view first, before assigning to the loudes speaker's camera.
                    vidyoConnector.HideView({ viewId: "renderer5"}).then(function() {
                        console.log("HideView Success *****");
                        --remoteSources.rendered;

                        // Assign slot 5 to the the loudest speaker
                        renderToSlot(vidyoConnector, remoteCameras, participant.id, 5);
                    }).catch(function(e) {
                        console.log("HideView Failed, loudest speaker not assigned");
                    });
                }
            } else {
                console.log("Warning: not rendering loudest speaker because max remote sources is 0.");
            }
        }
    }).then(function() {
        console.log("RegisterParticipantEventListener Success");
    }).catch(function() {
        console.err("RegisterParticipantEventListener Failed");
    });
	
	vidyoConnector.RegisterRemoteWindowShareEventListener({
        onAdded: function(remoteWindowShare, participant) {			
			
			if (sharing) {
				vidyoConnector.HideView({ viewId: "rendererS" }).then(function() {
					console.log("HideView Success");
				}).catch(function(e) {
					console.log("HideView Failed");
				});
			}
						
			vidyoConnector.AssignViewToRemoteWindowShare({
				viewId: "rendererS",
				remoteWindowShare: remoteWindowShare,
				displayCropped: false,
				allowZoom: false
			}).then(function(retValue) {
				console.log("AssignViewToRemoteWindowShare " + participant.id + " to slot S " + retValue);
				sharing = true
				updateRenderers(vidyoConnector, true);
				ShowRenderer(vidyoConnector, "rendererS");					
				
			}).catch(function() {
				console.log("AssignViewToRemoteWindowShare Failed");
			});
            
        },
        onRemoved: function(remoteWindowShare, participant) {			
			
			vidyoConnector.HideView({ viewId: "rendererS" }).then(function() {
                console.log("HideView Success");				
				sharing = false;
				updateRenderers(vidyoConnector, true);
                
			}).catch(function(e) {
                console.log("HideView Failed");
            });			
			
            console.log("RegisterRemoteWindowShareEventListener onRemoved participant.id : " + participant.id);
            		
        },
        onStateUpdated: function(remoteWindowShare, participant, state) {
            // Remote Window Share state was updated
        }
    }).then(function() {
        console.log("RegisterRemoteWindowShareEventListener Success");
    }).catch(function() {
        console.error("RegisterRemoteWindowShareEventListener Failed");
    });
	
}

function handleDeviceChange(vidyoConnector, cameras, microphones, speakers) {
    // Hook up camera selector functions for each of the available cameras
    $("#cameras").change(function() {
        // Camera selected from the drop-down menu
        $("#cameras option:selected").each(function() {
            // Hide the view of the previously selected local camera
            vidyoConnector.HideView({ viewId: "renderer0" }).then(function() {
                console.log("HideView Success");
            }).catch(function(e) {
                console.log("HideView Failed");
            });

            // Select the newly selected local camera
            camera = cameras[$(this).val()];
            vidyoConnector.SelectLocalCamera({
                localCamera: camera
            }).then(function() {
                console.log("SelectCamera Success");
            }).catch(function() {
                console.error("SelectCamera Failed");
            });
        });
    });

    // Hook up microphone selector functions for each of the available microphones
    $("#microphones").change(function() {
        // Microphone selected from the drop-down menu
        $("#microphones option:selected").each(function() {
            microphone = microphones[$(this).val()];
            vidyoConnector.SelectLocalMicrophone({
                localMicrophone: microphone
            }).then(function() {
                console.log("SelectMicrophone Success");
            }).catch(function() {
                console.error("SelectMicrophone Failed");
            });
        });
    });

    // Hook up speaker selector functions for each of the available speakers
    $("#speakers").change(function() {
        // Speaker selected from the drop-down menu
        $("#speakers option:selected").each(function() {
            speaker = speakers[$(this).val()];
            vidyoConnector.SelectLocalSpeaker({
                localSpeaker: speaker
            }).then(function() {
                console.log("SelectSpeaker Success");
            }).catch(function() {
                console.error("SelectSpeaker Failed");
            });
        });
    });
}

function getParticipantName(participant, cb) {
    if (!participant) {
        cb("Undefined");
        return;
    }

    if (participant.name) {
        cb(participant.name);
        return;
    }

    participant.GetName().then(function(name) {
        cb(name);
    }).catch(function() {
        cb("GetNameFailed");
    });
}

function showRenderers(vidyoConnector) {
    ShowRenderer(vidyoConnector, "renderer0");
    ShowRenderer(vidyoConnector, "renderer1");
    ShowRenderer(vidyoConnector, "renderer2");
    ShowRenderer(vidyoConnector, "renderer3");
    ShowRenderer(vidyoConnector, "renderer4");
    ShowRenderer(vidyoConnector, "renderer5");
}

function updateRenderers(vidyoConnector, fullscreen) {
    if (fullscreen) {
        $("#options").addClass("optionsHide");
        $("#rendererContainer").css({'position':'absolute','top': '0px', 'right': '0px', 'left': '0px', 'bottom': '60px', 'z-index': '99'})
		if (sharing) {
			$("#rendererS").css({'position': 'absolute', 'left': '50%', 'right': '0px', 'top': '0px', 'bottom': '30%',  'width': '50%','background-color': 'black'});
			$("#renderer5").css({'position': 'absolute', 'left': '0px', 'right': '50%', 'top': '0px', 'bottom': '30%',  'width': '50%','background-color': 'black'});
		}
		else {
			$("#rendererS").css({'position': 'absolute', 'width': '0px'});
			$("#renderer5").css({'position': 'absolute', 'left': '0px', 'right': '0px', 'top': '0px', 'bottom': '30%',  'width': '100%','background-color': 'black'});
		}
        $("#renderer1").css({'position': 'absolute', 'left': '0px', 'right':  '80%', 'top': '70%', 'bottom': '0px',  'width': '20%','background-color': 'gray'});
        $("#renderer2").css({'position': 'absolute', 'left':  '20%', 'right': '60%', 'top': '70%', 'bottom': '0px',  'width': '20%','background-color': 'darkgray'});
        $("#renderer0").css({'position': 'absolute', 'left': '40%', 'right': '40%', 'top': '70%', 'bottom': '0px',  'width': '20%','background-color': 'gray'});
        $("#renderer3").css({'position': 'absolute', 'left': '60%', 'right':  '20%', 'top': '70%', 'bottom': '0px',  'width': '20%','background-color': 'darkgray'});
        $("#renderer4").css({'position': 'absolute', 'left':  '80%', 'right': '0px', 'top': '70%', 'bottom': '0px', 'width': '20%', 'background-color': 'gray'});        
    } else {
        $("#options").removeClass("optionsHide");
        $("#rendererContainer").css({'position':'absolute','top': '0px', 'right': '0px', 'left': '350px', 'bottom': '60px', 'z-index': '99'})
        $("#renderer0").css({'position': 'absolute', 'left': '0px', 'right': '0%', 'top': '0px', 'bottom': '0px',  'width': '100%'});
        $("#renderer1").css({'position': 'absolute', 'width': '0px'});
        $("#renderer2").css({'position': 'absolute', 'width': '0px'});
        $("#renderer3").css({'position': 'absolute', 'width': '0px'});
        $("#renderer4").css({'position': 'absolute', 'width': '0px'});
        $("#renderer5").css({'position': 'absolute', 'width': '0px'});
		$("#rendererS").css({'position': 'absolute', 'width': '0px'});
    }

    showRenderers(vidyoConnector);
}

// Attempt to connect to the conference
// We will also handle connection failures
// and network or server-initiated disconnects.
function connectToConference(vidyoConnector, remoteCameras, configParams) {

    // Clear messages
    $("#error").html("");
    $("#message").html("<h3 class='blink'>CONNECTING...</h3>");

    vidyoConnector.ConnectToRoomAsGuest({
	//vidyoConnector.Connect({
        // Take input from options form
        host: $("#portal").val(),
        displayName: $("#displayName").val(),
        roomKey: $("#roomKey").val(),
		roomPin: $("#roomPin").val(),

        // Define handlers for connection events.
        onSuccess: function() {
            // Connected
            console.log("vidyoConnector.Connect : onSuccess callback received");
            $("#connectionStatus").html("Connected");

            if (configParams.hideConfig != "1") {
                updateRenderers(vidyoConnector, true);
            }
            $("#message").html("");

            // Register for resource manager events
            vidyoConnector.RegisterResourceManagerEventListener({
                onAvailableResourcesChanged: function(cpuEncode, cpuDecode, bandwidthSend, bandwidthReceive) {
                    //console.log("onAvailableResourcesChanged: cpuEncode=" + cpuEncode + ", cpuDecode=" + cpuDecode +
                    //    ", bandwidthSend=" + bandwidthSend + ", bandwidthReceive=" + bandwidthReceive);
                },
                onMaxRemoteSourcesChanged: function(maxRemoteSources) {
                    //console.log("****** onMaxRemoteSourcesChanged: maxRemoteSources=" + maxRemoteSources);
                    if ((maxRemoteSources < remoteSources.max) && (remoteSources.rendered > maxRemoteSources)) {
                        //console.log("****** maxRemoteSources dropped from " + remoteSources.max + " to " + maxRemoteSources + ". Removing " + (remoteSources.rendered - maxRemoteSources) + " remote sources");
                        for (var i = rendererSlots.length - 1; i > 0; --i) {
                            if (rendererSlots[i] != OPEN_REMOTE_SLOT) {
                                // Set the isRendered flag to false of the remote camera which is being hidden
                                remoteCameras[rendererSlots[i]].isRendered = false;

                                // Open up the slot
                                rendererSlots[i] = OPEN_REMOTE_SLOT;

                                // Hide the view
                                vidyoConnector.HideView({ viewId: "renderer" + (i) }).then(function() {
                                    console.log("HideView Success: slot=" + i);
                                }).catch(function(e) {
                                    console.error("HideView Failed: slot=" + i);
                                });

                                // Decrement the number of remote sources rendered and break out of loop
                                // if we now have now rendered the max number of participants.
                                --remoteSources.rendered;
                                if (remoteSources.rendered == maxRemoteSources)
                                    break;
                            }
                        }
                    } else if ((maxRemoteSources > remoteSources.max) && (remoteSources.count > remoteSources.max)) {
                        // The maxRemoteSources increased and we have additional sources to render.
                        //console.log("****** maxRemoteSources increased from " + remoteSources.max + " to " + maxRemoteSources);
                        var numSourcesToAdd = maxRemoteSources - remoteSources.rendered;
                        var addedSources = 0;
                        //console.log("******* ...will attempt to add " + numSourcesToAdd + " sources");

                        // Search for a remote camera to render.
                        for (var id in remoteCameras) {
                            if (!remoteCameras[id].isRendered) {
                                // If an open slot is found then render remote camera stream to it.
                                var openSlot = findOpenSlot();
                                if (openSlot > 0) 
                                    renderToSlot(vidyoConnector, remoteCameras, id, openSlot);

                                // Check if we have added our allotment of remote sources. If so, then break out of loop.
                                ++addedSources;
                                if (addedSources == numSourcesToAdd)
                                    break;
                            }
                        }
                    }
                    // Update the stored max remote sources value.
                    remoteSources.max = maxRemoteSources;
                }
            }).then(function() {
                console.log("RegisterResourceManagerEventListener Success");
            }).catch(function() {
                console.error("RegisterResourceManagerEventListener Failed");
            });
        },
        onFailure: function(reason) {
            // Failed
            console.error("vidyoConnector.Connect : onFailure callback received. Reason: " + reason);
            connectorDisconnected(vidyoConnector, remoteCameras, "Failed", "");
            $("#error").html("<h3>Call Failed: " + reason + "</h3>");
        },
        onDisconnected: function(reason) {
            // Disconnected
            console.log("vidyoConnector.Connect : onDisconnected callback received");
            connectorDisconnected(vidyoConnector, remoteCameras, "Disconnected", "Call Disconnected: " + reason);

            if (configParams.hideConfig != "1") {
               updateRenderers(vidyoConnector, false);
            }
        }
    }).then(function(status) {
        if (status) {
            console.log("Connect Success");
        } else {
            console.error("Connect Failed");
            connectorDisconnected(vidyoConnector, remoteCameras, "Failed", "");
            $("#error").html("<h3>Call Failed" + "</h3>");
        }
    }).catch(function() {
        console.error("Connect Failed");
        connectorDisconnected(vidyoConnector, remoteCameras, "Failed", "");
        $("#error").html("<h3>Call Failed" + "</h3>");
    });
}

// Connector either fails to connect or a disconnect completed, update UI
// elements and clear rendererSlots and remoteCameras.
function connectorDisconnected(vidyoConnector, remoteCameras, connectionStatus, message) {
    $("#connectionStatus").html(connectionStatus);
    $("#message").html(message);
    $("#participantStatus").html("");
    $("#joinLeaveButton").removeClass("callEnd").addClass("callStart");
    $('#joinLeaveButton').prop('title', 'Join Conference');

    // Clear rendererSlots and remoteCameras when not connected in case not cleared
    // in RegisterRemoteCameraEventListener onRemoved.
    for (var i = 1; i < rendererSlots.length; i++) {
        if (rendererSlots[i] != OPEN_REMOTE_SLOT) {
            rendererSlots[i] = OPEN_REMOTE_SLOT;
            console.log("Calling HideView on renderer" + i);
            vidyoConnector.HideView({ viewId: "renderer" + (i) }).then(function() {
                console.log("HideView Success");
            }).catch(function(e) {
                console.log("HideView Failed");
            });
        }
    }
    remoteCameras = {};
    remoteSources.max = 5;
    remoteSources.count = 0;
    remoteSources.rendered = 0;

    // Unregister for resource manager events
    vidyoConnector.UnregisterResourceManagerEventListener().then(function() {
        console.log("UnregisterResourceManagerEventListener Success");
    }).catch(function() {
        console.error("UnregisterResourceManagerEventListener Failed");
    });
}
