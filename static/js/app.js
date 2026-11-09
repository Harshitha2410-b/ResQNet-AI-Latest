
"use strict";

// ==========================================
// ResQNet AI - Complete Monitoring Application
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

function setText(id, value) {
    const element = getElement(id);
    if (element) element.textContent = value;
}

function setMonitoringStatus(value) {
    const status = document.querySelector(".monitoring-status");

    if (status) {
        status.innerHTML =
            `<span class="status-dot"></span>${value}`;
    }
}

function updateDistressCount() {
    setText("distress-count", String(distressCount));
}

// ==========================================
// START MONITORING
// ==========================================

async function startMonitoring() {
    if (monitoringActive) return;

    const button = document.querySelector(".monitor-btn");

    if (!navigator.mediaDevices?.getUserMedia) {
        alert("Microphone access requires localhost or HTTPS.");
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
                noiseSuppression: true
            }
        });

        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) {
            throw new Error("AudioContext is unsupported.");
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
            button.disabled = false;
            button.textContent = "Stop Monitoring";
            button.onclick = stopMonitoring;
        }

        monitorAudioLevel();
        startVoiceRecognition();

        console.log("ResQNet AI monitoring started.");

    } catch (error) {
        console.error("Microphone error:", error);
        stopAudioResources();

        setMonitoringStatus("SYSTEM READY");
        setText("audio-status", "Microphone unavailable.");

        if (button) {
            button.disabled = false;
            button.textContent = "Start Monitoring";
            button.onclick = startMonitoring;
        }

        alert("Allow microphone permission and try again.");
    }
}

// ==========================================
// STOP MONITORING
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
        button.disabled = false;
        button.textContent = "Start Monitoring";
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
        const percentage = Math.min(Math.round(rms * 500), 100);

        setText("audio-level-value", percentage + "%");

        const bar = getElement("audio-level-bar");
        if (bar) bar.style.width = percentage + "%";

        if (percentage < 10) {
            setText("audio-status", "Listening for audio...");
        } else if (percentage < 50) {
            setText("audio-status", "Audio detected");
        } else {
            setText("audio-status", "Loud audio detected");
        }

        animationFrameId = requestAnimationFrame(updateLevel);
    }

    updateLevel();
}

// ==========================================
// VOICE RECOGNITION
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
                console.warn("Speech recognition restart failed.");
            }
        }
    };

    try {
        recognition.start();
    } catch (error) {
        console.warn("Speech recognition could not start:", error);
    }
}

// ==========================================
// EMERGENCY KEYWORD DEMO
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

    console.warn("Potential distress phrase:", match);
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
        if (status) status.textContent = `SOS activation: ${taps}/3`;

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
            timeElement.textContent = "Activated: " + new Date().toLocaleString();
        }

        if (locationElement) {
            locationElement.textContent = "Getting GPS location...";
        }

        // First get GPS location.
        let latitude = null;
        let longitude = null;

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
                        "GPS unavailable. Alert will be sent without location.";
                }
            }
        } else if (locationElement) {
            locationElement.textContent = "GPS not supported by this browser.";
        }

        // Send SOS and GPS to Flask backend.
        try {
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
                status.textContent = `SOS recorded. Alert ID: ${data.alert_id}`;
            }

            if (triggerStatus) {
                triggerStatus.textContent = "SOS RECORDED";
            }

            button.textContent = "SOS RECORDED";

            setText("sos-alert-id", data.alert_id ?? "Not provided");
            setText("sos-sms-status", data.sms_status ?? "Not available");
            setText("sos-call-status", data.call_status ?? "Not available");

            await loadSOSHistory();

        } catch (error) {
            console.error("SOS request failed:", error);

            if (status) {
                status.textContent = "SOS could not be saved: " + error.message;
            }

            button.textContent = "RETRY SOS";
        } finally {
            button.disabled = false;
            sosRequestInProgress = false;
        }
    });
}

async function loadSOSHistory() {
    const historyList = getElement("alert-history-list");
    if (!historyList) return;

    historyList.textContent = "Loading alerts...";

    try {
        const response = await fetch("/api/alerts");
        if (!response.ok) {
            throw new Error("Unable to load alert history.");
        }

        const data = await response.json();
        const alerts = Array.isArray(data) ? data : (data.alerts || []);

        historyList.replaceChildren();

        if (alerts.length === 0) {
            historyList.textContent = "No emergency alerts recorded yet.";
            return;
        }

        alerts.forEach(alert => {
            const item = document.createElement("div");
            item.className = "alert-history-item";

            const heading = document.createElement("h4");
            heading.textContent =
                `Alert #${alert.id} - ${alert.alert_type || "SOS"}`;

            const date = document.createElement("p");
            date.textContent = `Time: ${alert.created_at || "Not available"}`;

            const sms = document.createElement("p");
            sms.textContent = `SMS: ${alert.sms_status || "Not available"}`;

            const call = document.createElement("p");
            call.textContent = `Call: ${alert.call_status || "Not available"}`;

            item.append(heading, date, sms, call);

            if (alert.latitude != null && alert.longitude != null) {
                const map = document.createElement("a");
                map.href = `https://www.google.com/maps?q=${alert.latitude},${alert.longitude}`;
                map.target = "_blank";
                map.rel = "noopener noreferrer";
                map.textContent = "View location";
                item.appendChild(map);
            }

            historyList.appendChild(item);
        });

    } catch (error) {
        console.error("Alert history error:", error);
        historyList.textContent = "Could not load alert history.";
    }
}

// ==========================================
// FALL DETECTION
// ==========================================

function initializeFallDetection() {
    const startButton = getElement("fall-start-btn");
    const resetButton = getElement("fall-reset-btn");
    const status = getElement("fall-status");
    const message = getElement("fall-message");

    if (!startButton || !status || !message) {
        console.warn("Fall detection HTML elements are missing.");
        return;
    }

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

    // Create the test button only if it doesn't already exist.
    let testButton = getElement("fall-test-btn");

    if (!testButton) {
        testButton = document.createElement("button");
        testButton.id = "fall-test-btn";
        testButton.type = "button";
        testButton.textContent = "TEST FALL DETECTION";
        testButton.className = "fall-button";
        testButton.style.marginTop = "10px";

        startButton.insertAdjacentElement("afterend", testButton);
    }

    // Hide Reset Alert initially.
    if (resetButton) {
        resetButton.hidden = true;
        resetButton.style.display = "none";
    }

    // Enable actual motion sensor monitoring.
    async function enableFallDetection() {
        if (!("DeviceMotionEvent" in window)) {
            status.textContent = "UNAVAILABLE";
            message.textContent =
                "This browser does not support motion sensors.";
            return;
        }

        try {
            if (typeof DeviceMotionEvent.requestPermission === "function") {
                const permission =
                    await DeviceMotionEvent.requestPermission();

                if (permission !== "granted") {
                    throw new Error("Motion permission denied.");
                }
            }

            window.removeEventListener("devicemotion", onMotion);
            window.addEventListener("devicemotion", onMotion);

            active = true;
            sensorEvents = 0;

            startButton.disabled = true;
            startButton.textContent = "FALL DETECTION ACTIVE";

            status.textContent = "ACTIVE";
            message.textContent = "Waiting for motion sensor readings...";

            setTimeout(() => {
                if (active && sensorEvents === 0 && !alertPending) {
                    status.textContent = "NO SENSOR DATA";
                    message.textContent =
                        "No usable motion data received. Try a compatible mobile device.";
                }
            }, 5000);

        } catch (error) {
            console.error("Fall sensor setup failed:", error);

            status.textContent = "PERMISSION ERROR";
            message.textContent =
                "Motion sensor permission denied or unavailable.";

            startButton.disabled = false;
            startButton.textContent = "ENABLE FALL DETECTION";
        }
    }

    // Process real device motion data.
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

    // Shared handler for both simulated and real sensor events.
    function showPossibleFall() {
        if (alertPending) return;

        alertPending = true;

        status.textContent = "CHECK REQUIRED";
        message.textContent =
            "Possible fall detected. Please check the person.";

        if (resetButton) {
            resetButton.hidden = false;
            resetButton.style.display = "inline-flex";
            resetButton.disabled = false;
            resetButton.textContent = "RESET ALERT";
        }

        // The dashboard updates even if the user dismisses the popup.
        const personOkay = window.confirm(
            "Possible fall-like movement detected.\n\n" +
            "Press OK if the person is okay. " +
            "Press Cancel if help may be needed."
        );

        if (personOkay) {
            alertPending = false;
            status.textContent = active ? "ACTIVE" : "READY";
            message.textContent = active
                ? "Monitoring motion..."
                : "Sensor not started.";

            if (resetButton) {
                resetButton.hidden = true;
                resetButton.style.display = "none";
            }
        } else {
            // Cancel means further checking may be needed.
            status.textContent = "CHECK REQUIRED";
            message.textContent =
                "Please check the person or contact a trusted person. " +
                "No SMS or emergency notification was sent.";

            if (resetButton) {
                resetButton.hidden = false;
                resetButton.style.display = "inline-flex";
            }
        }
    }

    // Simulation button for project demonstration only.
    testButton.addEventListener("click", () => {
        if (alertPending) {
            message.textContent =
                "Reset the previous alert before running another test.";
            return;
        }

        if (testTimer) clearTimeout(testTimer);

        status.textContent = "TESTING";
        message.textContent =
            "Simulating a fall event for demonstration...";

        testButton.disabled = true;

        testTimer = setTimeout(() => {
            testTimer = null;
            testButton.disabled = false;
            showPossibleFall();
        }, 1000);
    });

    // Reset handler: this was missing from the uploaded code.
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
            resetButton.style.display = "none";

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

    loadSOSHistory();

    const refreshButton = getElement("refresh-alerts");

    if (refreshButton) {
        refreshButton.addEventListener("click", loadSOSHistory);
    }
});