import { GoogleGenerativeAI } from '@google/generative-ai';

// --- Config ---
const GEMINI_API_KEY = 'AIzaSyAQk0mjppyFMx_M060Ef37h1dhHG_WPaLo';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- State ---
const state = {
    isListening: false,
    shouldListen: false,
    transcript: [],
    bullshitLevel: 0, // 0-100
    recognition: null,
};

// --- DOM Elements ---
const elements = {
    btnToggle: document.getElementById('btnToggle'),
    btnText: document.getElementById('btnText'),
    transcript: document.getElementById('transcript'),
    meterFill: document.getElementById('meterFill'),
    bsValue: document.getElementById('bsValue'),
    feedContainer: document.getElementById('feedContainer'),
    alarmOverlay: document.getElementById('alarmOverlay'),
    sysStatus: document.getElementById('sysStatus'),
    sysTime: document.getElementById('sysTime'),
    alarmSound: document.getElementById('alarmSound'),
};

// --- Init Speech Recognition ---
function initSpeech() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        alert('Browser not supported. Please use Chrome.');
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'de-DE';

    recognition.onstart = () => {
        state.isListening = true;
        updateUI(true);
    };

    recognition.onend = () => {
        state.isListening = false;

        if (state.shouldListen) {
            try {
                recognition.start();
            } catch (e) {
                state.shouldListen = false;
                updateUI(false);
            }
        } else {
            updateUI(false);
        }
    };

    recognition.onresult = handleSpeechResult;
    recognition.onerror = (event) => {
        console.error('Speech error:', event.error);
        if (event.error === 'not-allowed') {
            state.shouldListen = false;
            updateUI(false);
        }
    };

    state.recognition = recognition;
}

// --- Logic ---

let silenceTimer = null;
let accumBuffer = ""; // Buffer to accumulate text before sending to AI

function handleSpeechResult(event) {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
        } else {
            interimTranscript += event.results[i][0].transcript;
        }
    }

    // Update Transcript UI
    renderTranscript(finalTranscript, interimTranscript);

    // If we have a final sentence, send it to analysis BUFFER
    if (finalTranscript.trim().length > 0) {
        accumBuffer += " " + finalTranscript;

        // Debounce AI Call: Wait 1s silence or check if buffer is long enough
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            if (accumBuffer.trim().length > 10) { // Min length check
                analyzeText(accumBuffer);
                accumBuffer = "";
            }
        }, 800);
    }
}

function renderTranscript(final, interim) {
    // We only append final text permanently, interim is transient
    if (final) {
        const p = document.createElement('p');
        p.className = 'transcript-line final';
        p.textContent = `> ${final}`;
        elements.transcript.appendChild(p);
        elements.transcript.scrollTop = elements.transcript.scrollHeight;
    }

    // Handle interim display (optional, could overwrite last line)
}

// --- AI Analysis ---

async function analyzeText(text) {
    if (!text) return;

    updateStatus("ANALYZING...", "warn");

    const prompt = `
    Analysiere diesen Text.
    Ignoriere:
    - Belanglosen Smalltalk ("Hallo", "Wie geht's", "Wetter ist schön")
    - Private Aussagen ("Ich wohne in...", "Meine Nummer ist...")
    - Subjektive Meinungen ("Ich mag Pizza")

    Prüfe NUR auf:
    1. Faktische Fehler (Lügen)
    2. Logikfehler / Schein-Argumente
    3. Starke Übertreibungen / Panikmache
    4. Wenn es eine relevante, prüfbare Aussage ist -> OK.

    Text: "${text}"

    Antworte NUR als JSON:
    {
        "status": "BULLSHIT" | "OK" | "WARNING" | "IGNORE",
        "score": 0-100, (100 = totaler Bullshit, 0 = pure Wahrheit)
        "reason": "Kurze Korrektur (nur wenn nicht IGNORE)",
        "type": "FACT" | "LOGIC" | "EXAGGERATION" | "NONE"
    }
    `;

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        // Parse JSON
        const cleanJson = responseText.replace(/```json|```/g, '').trim();
        const data = JSON.parse(cleanJson);

        handleAnalysisResult(data);

    } catch (error) {
        console.error("AI Error:", error);
        updateStatus("SYSTEM ERROR", "danger");
    }
}

function handleAnalysisResult(data) {
    if (data.status === 'IGNORE') {
        updateStatus("FILTERED (IRRELEVANT)", "muted");
        return;
    }
    updateMeter(data.score);

    if (data.status === 'BULLSHIT' || data.status === 'WARNING') {
        if (data.score > 70) triggerAlarm();
        addFactCard(data);
        updateStatus("BULLSHIT DETECTED", "danger");
    } else {
        updateStatus("SCANNING...", "safe");
        if (Math.random() > 0.8) { // Occasional "Truth Verified" card
            addFactCard({ status: 'OK', reason: 'Faktisch korrekt.', type: 'FACT' });
        }
    }
}

// --- UI Updates ---

// --- UI Updates ---

function updateMeter(score) {
    // Minimalist: just width and color, no complex animation for color shifting needed if CSS handles it
    // But we need to update the value text

    elements.meterFill.style.width = `${score}%`;

    // Counter animation
    let start = parseInt(elements.bsValue.innerText.replace('%', '')) || 0;
    let end = score;
    let duration = 600;
    let startTime = null;

    function animate(currentTime) {
        if (!startTime) startTime = currentTime;
        let progress = (currentTime - startTime) / duration;
        if (progress > 1) progress = 1;

        let val = Math.floor(start + (end - start) * progress);
        elements.bsValue.innerText = `${val}%`;

        if (progress < 1) requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);

    // Color logic (Clean)
    /* CSS var(--safe), var(--warn), var(--accent) are used. 
       We can set the background color of the bar directly here if needed, 
       or toggle classes. Direct style is easier for gradient/color shifting. */

    if (score < 30) {
        elements.meterFill.style.background = 'var(--safe)';
    } else if (score < 70) {
        elements.meterFill.style.background = 'var(--warn)';
    } else {
        elements.meterFill.style.background = 'var(--accent)';
    }
}

function triggerAlarm() {
    elements.alarmOverlay.classList.add('active');

    // Play sound
    elements.alarmSound.currentTime = 0;
    elements.alarmSound.volume = 0.3; // Softer volume for minimalist vibe?
    elements.alarmSound.play().catch(e => console.log('Audio autoplay blocked'));

    setTimeout(() => {
        elements.alarmOverlay.classList.remove('active');
    }, 1200);
}

function addFactCard(data) {
    const card = document.createElement('div');
    card.className = `fact-card ${data.status === 'OK' ? 'fact' : 'bullshit'}`;

    // Clean iconography
    let icon = data.status === 'OK' ? 'Checks out' : 'Bullshit';
    if (data.status === 'WARNING') icon = 'Warning';

    card.innerHTML = `
        <div class="card-icon">${data.status === 'OK' ? '✅' : '🚨'}</div>
        <div class="card-content">
            <div class="card-header">
                <span>${data.type || 'INFO'}</span>
                <span>${data.score || 0}% BS</span>
            </div>
            <div class="card-text">${data.reason}</div>
        </div>
    `;

    elements.feedContainer.prepend(card); // Add to bottom (reverse flex logic in CSS)

    // In CSS: flex-direction: column-reverse; so prepend adds to the "visual bottom" which is actually the end of list?
    // Wait, column-reverse means first child is at bottom. 
    // If I want new cards to appear at the bottom and push others up:
    // AppendChild would put it at the "visual top" in column-reverse.
    // Prepend puts it at the "visual bottom". Correct.

    // Remove old cards
    if (elements.feedContainer.children.length > 5) {
        elements.feedContainer.lastElementChild.remove();
    }
}

function updateStatus(text, type) {
    if (!elements.sysStatus) return;
    elements.sysStatus.textContent = text;
    // Removed complex styling, keep it clean
    if (type === 'safe') elements.sysStatus.style.color = 'var(--safe)';
    else if (type === 'warn') elements.sysStatus.style.color = 'var(--warn)';
    else if (type === 'danger') elements.sysStatus.style.color = 'var(--accent)';
    else elements.sysStatus.style.color = 'var(--text-muted)';
}

function updateUI(isListening) {
    if (isListening) {
        elements.btnToggle.classList.add('active');
        elements.btnText.textContent = "Listening...";
        updateStatus("Analyzing audio...", "safe");
        document.querySelector('.placeholder')?.remove();
    } else {
        elements.btnToggle.classList.remove('active');
        elements.btnText.textContent = "Start Listening";
        updateStatus("Ready", "muted");
    }
}

// --- Clock Removed (Minimalist) ---

// --- Event Listeners ---
elements.btnToggle.addEventListener('click', () => {
    if (!state.recognition) initSpeech();

    state.shouldListen = !state.shouldListen;

    if (state.shouldListen) {
        if (!state.isListening) {
            try { state.recognition.start(); } catch (e) { }
        }
    } else {
        state.recognition.stop();
        updateUI(false);
    }
});
