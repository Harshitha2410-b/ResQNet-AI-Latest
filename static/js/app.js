"use strict";

// ==========================================
// RESQNET AI - COMPLETE MONITORING APP
// ==========================================

let microphoneStream = null;
let audioContext = null;
let audioAnalyser = null;
let animationFrameId = null;
let speechRecognition = null;

let monitoringActive = false;
let distressCount = 0;
let lastDistressTime = 0;
let sosRequestInProgress = false;

// ==========================================
// COMMON HELPERS
// ==========================================

function getElement(id) {
    return document.getElementById(id);
}

function setText(id, text) {
    const element = getElement(id);
    if (element) element.textContent = text;
}

function setMonitoringStatus(text) {
    const status = document.querySelector(".monitoring-status");

    if (status) {
        status.innerHTML = `
            <span class="status-dot"></span>
            ${text}
        `;
    }
}

function updateDistressCount() {
    setText("distress-count", String(distressCount));
}

// ==========================================
// START VOICE MONITORING
// ==========================================

async function startMonitoring() {
    if (monitoringActive) return;

    const button = document.querySelector(".monitor-btn");

    if (!navigator.mediaDevices?.getUserMedia) {
        alert("Microphone access requires HTTPS or localhost.");
        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent = "Requesting Microphone...";
    }

    try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false
            }
        });

        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
            throw new Error("AudioContext is not supported.");
        }

        audioContext = new AudioContextClass();

        if (audioContext.state === "suspended") {
            await audioContext.resume();
        }

        const source =
            audioContext.createMediaStreamSource(microphoneStream);

        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 2048;
        audioAnalyser.smoothingTimeConstant = 0.8;

        source.connect(audioAnalyser);

        monitoringActive = true;
        distressCount = 0;
        lastDistressTime = 0;

        updateDistressCount();
        setMonitoringStatus("MONITORING ACTIVE");
        setText("audio-status", "Listening for audio...");

        if (button) {
            button.textContent = "Stop Monitoring";
            button.disabled = false;
            button.onclick = stopMonitoring;
        }

        monitorAudioLevel();
        startVoiceRecognition();

    } catch (error) {
        console.error("Microphone error:", error);

        stopAudioResources();

        setMonitoringStatus("SYSTEM READY");
        setText("audio-status", "Microphone unavailable.");

        if (button) {
            button.textContent = "Start Monitoring";
            button.disabled = false;
            button.onclick = startMonitoring;
        }

        alert("Allow microphone permission and try again.");
    }
}

// ==========================================
// STOP VOICE MONITORING
// ==========================================

function stopMonitoring() {
    monitoringActive = false;

    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    if (speechRecognition) {
        const recognition = speechRecognition;
        speechRecognition = null;
        recognition.onend = null;

        try {
            recognition.stop();
        } catch (error) {
            console.warn("Speech recognition already stopped.");
        }
    }

    stopAudioResources();

    setMonitoringStatus("MONITORING STOPPED");
    setText("audio-status", "Monitoring stopped.");
    setText("audio-level-value", "0%");

    const bar = getElement("audio-level-bar");
    if (bar) bar.style.width = "0%";

    const button = document.querySelector(".monitor-btn");

    if (button) {
        button.textContent = "Start Monitoring";
        button.disabled = false;
        button.onclick = startMonitoring;
    }
}

function stopAudioResources() {
    if (microphoneStream) {
        microphoneStream.getTracks().forEach(track => track.stop());
        microphoneStream = null;
    }

    if (audioContext) {
        const context = audioContext;
        audioContext = null;

        if (context.state !== "closed") {
            context.close().catch(console.error);
        }
    }

    audioAnalyser = null;
}

// ==========================================
// LIVE AUDIO LEVEL
// ==========================================

function monitorAudioLevel() {
    if (!audioAnalyser || !monitoringActive) return;

    const analyser = audioAnalyser;
    const data = new Uint8Array(analyser.fftSize);

    function updateLevel() {
        if (!monitoringActive || analyser !== audioAnalyser) return;

        analyser.getByteTimeDomainData(data);

        let sum = 0;

        for (let i = 0; i < data.length; i++) {
            const sample = (data[i] - 128) / 128;
            sum += sample * sample;
        }

        const rms = Math.sqrt(sum / data.length);
        const percent = Math.min(Math.round(rms * 500), 100);

        setText("audio-level-value", percent + "%");

        const bar = getElement("audio-level-bar");
        if (bar) bar.style.width = percent + "%";

        if (percent < 10) {
            setText("audio-status", "Listening for audio...");
        } else if (percent < 50) {
            setText("audio-status", "Audio detected");
        } else {
            setText("audio-status", "Loud audio detected");
        }

        animationFrameId = requestAnimationFrame(updateLevel);
    }

    updateLevel();
}

// ==========================================
// SPEECH RECOGNITION
// ==========================================

function startVoiceRecognition() {
    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        setText(
            "audio-status",
            "Microphone active; speech recognition unsupported."
        );
        return;
    }

    const recognition = new SpeechRecognition();

    speechRecognition = recognition;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = event => {
        if (!monitoringActive) return;

        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (!event.results[i].isFinal) continue;

            const transcript =
                event.results[i][0].transcript.toLowerCase().trim();

            console.log("Recognized speech:", transcript);

            setText("audio-status", `Speech detected: "${transcript}"`);

            checkEmergencyKeywords(transcript);
        }
    };

    recognition.onerror = event => {
        console.warn("Speech recognition error:", event.error);

        if (event.error === "not-allowed") {
            setText("audio-status", "Speech recognition permission denied.");
        }
    };

    recognition.onend = () => {
        if (monitoringActive && speechRecognition === recognition) {
            try {
                recognition.start();
            } catch (error) {
                console.warn("Could not restart speech recognition.");
            }
        }
    };

    try {
        recognition.start();
    } catch (error) {
        console.warn("Could not start speech recognition:", error);
    }
}

// ==========================================
// EMERGENCY KEYWORD DETECTION
// ==========================================

function checkEmergencyKeywords(transcript) {
    const phrases = [
        "help me",
        "help",
        "save me",
        "emergency",
        "call the police",
        "i need help"
    ];

    const match = phrases.find(phrase => transcript.includes(phrase));

    if (!match) return;

    const now = Date.now();

    if (now - lastDistressTime < 10000) return;

    lastDistressTime = now;
    distressCount++;

    updateDistressCount();

    setText(
        "audio-status",
        `Potential distress phrase recognized: "${match}"`
    );

    console.warn("Potential distress phrase detected:", match);
}

// ==========================================
// SILENT SOS - THREE TAPS
// ==========================================

function initializeSilentSOS() {
    const button = getElement("sos-button");
    const status = getElement("sos-status");
    const triggerStatus = getElement("sos-trigger-status");
    const result = getElement("sos-result");
    const timeElement = getElement("sos-time");
    const locationElement = getElement("sos-location");
    const mapLink = getElement("sos-map");

    if (!button || button.dataset.initialized === "true") return;

    button.dataset.initialized = "true";

    let taps = 0;
    let timer = null;

    button.addEventListener("click", async () => {
        if (sosRequestInProgress) return;

        taps++;

        if (status) {
            status.textContent = `SOS activation: ${taps}/3`;
        }

        clearTimeout(timer);

        if (taps < 3) {
            timer = setTimeout(() => {
                taps = 0;
                if (status) status.textContent = "SOS inactive";
            }, 2000);

            return;
        }

        taps = 0;
        sosRequestInProgress = true;

        button.disabled = true;
        button.textContent = "ACTIVATING SOS";

        if (result) result.hidden = false;

        if (timeElement) {
            timeElement.textContent =
                "Activated: " + new Date().toLocaleString();
        }

        if (locationElement) {
            locationElement.textContent = "Getting GPS location...";
        }

        let latitude = null;
        let longitude = null;

        // GET GPS LOCATION

        if (navigator.geolocation) {
            try {
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(
                        resolve,
                        reject,
                        {
                            enableHighAccuracy: true,
                            timeout: 10000,
                            maximumAge: 0
                        }
                    );
                });

                latitude = position.coords.latitude;
                longitude = position.coords.longitude;

                if (locationElement) {
                    locationElement.textContent =
                        `Location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
                }

                if (mapLink) {
                    mapLink.href =
                        `https://www.google.com/maps?q=${latitude},${longitude}`;

                    mapLink.hidden = false;
                }

            } catch (error) {
                console.warn("GPS unavailable:", error.message);

                if (locationElement) {
                    locationElement.textContent =
                        "GPS unavailable. Sending alert without location.";
                }
            }
        } else {
            if (locationElement) {
                locationElement.textContent =
                    "GPS is not supported by this browser.";
            }
        }

        try {
            // SAVE SOS ALERT TO SERVER

            const response = await fetch("/api/sos", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    source: "browser_dashboard",
                    latitude: latitude,
                    longitude: longitude
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || "Could not save SOS alert.");
            }

            if (status) {
                status.textContent =
                    `SOS recorded. Alert ID: ${data.alert_id}`;
            }

            if (triggerStatus) {
                triggerStatus.textContent = "SOS RECORDED";
            }

            button.textContent = "SOS RECORDED";

            setText("sos-alert-id", data.alert_id ?? "Not provided");
            setText("sos-sms-status", "Awaiting user confirmation");
            setText("sos-call-status", "Awaiting user confirmation");

            // CREATE SMS AND CALL OPTIONS

            const contact = data.emergency_contact;

            if (contact) {
                createSOSPhoneActions(
                    result,
                    contact,
                    data.alert_id,
                    latitude,
                    longitude
                );
            } else {
                if (status) {
                    status.textContent =
                        "SOS saved, but emergency contact was not received.";
                }
            }

            // REFRESH ALERT HISTORY

            if (typeof loadSOSHistory === "function") {
                await loadSOSHistory();
            }

        } catch (error) {
            console.error("SOS request failed:", error);

            if (status) {
                status.textContent = "SOS error: " + error.message;
            }

            button.textContent = "RETRY SOS";

        } finally {
            button.disabled = false;
            sosRequestInProgress = false;
        }
    });
}

// ==========================================
// CREATE ANDROID SMS AND PHONE BUTTONS
// ==========================================

function createSOSPhoneActions(
    result,
    contact,
    alertId,
    latitude,
    longitude
) {
    if (!result) return;

    const oldActions = getElement("sos-phone-actions");

    if (oldActions) oldActions.remove();

    const message =
        `RESQNET AI EMERGENCY ALERT\n` +
        `Possible emergency detected.\n` +
        `Alert ID: ${alertId}\n` +
        `Location: ${
            latitude !== null && longitude !== null
                ? `https://www.google.com/maps?q=${latitude},${longitude}`
                : "Unavailable"
        }\n` +
        `Please contact me immediately.`;

    const actions = document.createElement("div");

    actions.id = "sos-phone-actions";
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "12px";
    actions.style.marginTop = "15px";

    // SMS BUTTON

    const smsButton = document.createElement("a");

    smsButton.textContent = "OPEN SMS APP";
    smsButton.href =
        `sms:${contact}?body=${encodeURIComponent(message)}`;

    smsButton.style.padding = "12px 18px";
    smsButton.style.background = "#198754";
    smsButton.style.color = "white";
    smsButton.style.borderRadius = "8px";
    smsButton.style.textDecoration = "none";
    smsButton.style.display = "inline-block";

    // PHONE BUTTON

    const callButton = document.createElement("a");

    callButton.textContent = "OPEN PHONE DIALER";
    callButton.href = `tel:${contact}`;

    callButton.style.padding = "12px 18px";
    callButton.style.background = "#0d6efd";
    callButton.style.color = "white";
    callButton.style.borderRadius = "8px";
    callButton.style.textDecoration = "none";
    callButton.style.display = "inline-block";

    // DISCLAIMER

    const note = document.createElement("p");

    note.textContent =
        "Press Send in SMS app or Call in Phone app to confirm. " +
        "No message or call is sent automatically.";

    note.style.width = "100%";
    note.style.fontSize = "13px";

    actions.append(smsButton, callButton, note);

    result.appendChild(actions);
}

// ==========================================
// FALL DETECTION
// ==========================================

function initializeFallDetection() {
    const startButton = getElement("fall-start-btn");
    const resetButton = getElement("fall-reset-btn");
    const status = getElement("fall-status");
    const message = getElement("fall-message");

    if (!startButton || !status || !message) return;

    if (startButton.dataset.initialized === "true") return;

    startButton.dataset.initialized = "true";

    let active = false;
    let impactTime = 0;
    let lastAlertTime = 0;
    let alertPending = false;
    let sensorEvents = 0;
    let testTimer = null;

    const IMPACT_THRESHOLD = 24;
    const QUIET_THRESHOLD = 13;
    const COOLDOWN = 10000;

    // FALL TEST BUTTON

    const simulateButton = document.createElement("button");

    simulateButton.type = "button";
    simulateButton.textContent = "TEST FALL DETECTION";
    simulateButton.className = "fall-button";
    simulateButton.style.marginTop = "10px";

    startButton.insertAdjacentElement("afterend", simulateButton);

    simulateButton.addEventListener("click", () => {
        if (alertPending) {
            message.textContent =
                "Reset the previous alert before testing again.";
            return;
        }

        if (testTimer) clearTimeout(testTimer);

        status.textContent = "TESTING";
        message.textContent =
            "Simulating a fall event for demonstration...";

        simulateButton.disabled = true;

        testTimer = setTimeout(() => {
            testTimer = null;
            simulateButton.disabled = false;
            showPossibleFall();
        }, 1000);
    });

    // ENABLE DEVICE MOTION

    async function enableFallDetection() {
        if (!("DeviceMotionEvent" in window)) {
            status.textContent = "UNAVAILABLE";
            message.textContent =
                "This browser does not support device motion.";

            return;
        }

        try {
            if (
                typeof DeviceMotionEvent.requestPermission === "function"
            ) {
                const permission =
                    await DeviceMotionEvent.requestPermission();

                if (permission !== "granted") {
                    throw new Error("Motion permission denied.");
                }
            }

            window.removeEventListener("devicemotion", onMotion);
            window.addEventListener("devicemotion", onMotion);

            active = true;

            startButton.disabled = true;
            startButton.textContent = "FALL DETECTION ACTIVE";

            status.textContent = "ACTIVE";
            message.textContent =
                "Waiting for device motion sensor readings...";

            setTimeout(() => {
                if (active && sensorEvents === 0) {
                    status.textContent = "NO SENSOR DATA";

                    message.textContent =
                        "No motion data received. Try a compatible mobile device.";
                }
            }, 5000);

        } catch (error) {
            console.error("Fall detection setup error:", error);

            status.textContent = "PERMISSION ERROR";
            message.textContent =
                "Motion sensor access denied or unavailable.";

            startButton.disabled = false;
            startButton.textContent = "ENABLE FALL DETECTION";
        }
    }

    // MOTION SENSOR EVENT

    function onMotion(event) {
        if (!active || alertPending) return;

        let x, y, z;

        if (
            event.acceleration &&
            event.acceleration.x != null &&
            event.acceleration.y != null &&
            event.acceleration.z != null
        ) {
            ({ x, y, z } = event.acceleration);

        } else if (
            event.accelerationIncludingGravity &&
            event.accelerationIncludingGravity.x != null &&
            event.accelerationIncludingGravity.y != null &&
            event.accelerationIncludingGravity.z != null
        ) {
            ({ x, y, z } = event.accelerationIncludingGravity);

        } else {
            return;
        }

        sensorEvents++;

        const magnitude = Math.sqrt(x * x + y * y + z * z);
        const now = Date.now();

        if (magnitude >= IMPACT_THRESHOLD) {
            impactTime = now;

            message.textContent =
                "Sudden movement detected. Checking motion...";

            return;
        }

        if (
            impactTime &&
            now - impactTime >= 300 &&
            now - impactTime <= 2500 &&
            magnitude <= QUIET_THRESHOLD &&
            now - lastAlertTime > COOLDOWN
        ) {
            impactTime = 0;
            lastAlertTime = now;

            showPossibleFall();
            return;
        }

        if (impactTime && now - impactTime > 2500) {
            impactTime = 0;
            message.textContent = "Monitoring motion...";
        }
    }

    // POSSIBLE FALL ALERT

    function showPossibleFall() {
        alertPending = true;

        status.textContent = "CHECK REQUIRED";

        message.textContent =
            "Possible fall detected. Please check the person or contact a trusted person.";

        if (resetButton) {
            resetButton.hidden = false;
            resetButton.disabled = false;
            resetButton.textContent = "RESET ALERT";
        }

        const okay = window.confirm(
            "Possible fall-like movement detected.\n\n" +
            "Press OK if the person is okay. " +
            "Press Cancel if help may be needed."
        );

        if (okay) {
            alertPending = false;

            status.textContent = active ? "ACTIVE" : "READY";
            message.textContent = active
                ? "Monitoring motion..."
                : "Sensor not started.";

            if (resetButton) resetButton.hidden = true;

        } else {
            status.textContent = "CHECK REQUIRED";

            message.textContent =
                "Please check the person. No SMS or emergency notification has been sent.";

            if (resetButton) resetButton.hidden = false;
        }
    }

    // RESET FALL ALERT

    if (resetButton) {
        resetButton.addEventListener("click", () => {
            alertPending = false;
            impactTime = 0;

            if (testTimer) {
                clearTimeout(testTimer);
                testTimer = null;
            }

            status.textContent = active ? "ACTIVE" : "READY";

            message.textContent = active
                ? "Monitoring motion..."
                : "Sensor not started.";

            resetButton.hidden = true;

            console.log("Fall alert reset.");
        });
    }

    startButton.addEventListener("click", enableFallDetection);
}

// ==========================================
// INITIALIZE ALL MODULES
// ==========================================

document.addEventListener("DOMContentLoaded", () => {
    const monitorButton = document.querySelector(".monitor-btn");

    if (monitorButton) {
        monitorButton.onclick = startMonitoring;
    }

    initializeSilentSOS();
    initializeFallDetection();

    console.log("ResQNet AI initialized.");
});
