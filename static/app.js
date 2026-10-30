// AudioNoise Detector AI - Client Script
document.addEventListener("DOMContentLoaded", () => {
  // Elements
  const feedbackAudio = document.getElementById("feedbackAudio");
  const toggleFeedback = document.getElementById("toggleFeedback");
  const btnTestNotif = document.getElementById("btnTestNotif");
  const feedbackVolume = document.getElementById("feedbackVolume");
  const feedbackCooldownSelect = document.getElementById("feedbackCooldown");

  // Mic Elements
  const tabMicBtn = document.getElementById("tabMicBtn");
  const tabFileBtn = document.getElementById("tabFileBtn");
  const micTab = document.getElementById("micTab");
  const fileTab = document.getElementById("fileTab");
  const btnToggleMic = document.getElementById("btnToggleMic");
  const micMainIcon = document.getElementById("micMainIcon");
  const micBtnMainText = document.getElementById("micBtnMainText");
  const micBtnSubText = document.getElementById("micBtnSubText");
  const listeningBar = document.getElementById("listeningBar");
  const listeningStatusText = document.getElementById("listeningStatusText");
  const chunkProgress = document.getElementById("chunkProgress");
  const selectInterval = document.getElementById("selectInterval");
  const visualizerCanvas = document.getElementById("visualizerCanvas");
  const visualizerOverlay = document.getElementById("visualizerOverlay");

  // File Elements
  const dropZone = document.getElementById("dropZone");
  const audioFileInput = document.getElementById("audioFileInput");
  const btnBrowseFile = document.getElementById("btnBrowseFile");
  const btnTestCobasuara = document.getElementById("btnTestCobasuara");
  const fileUploadInfo = document.getElementById("fileUploadInfo");
  const fileNameDisplay = document.getElementById("fileNameDisplay");
  const fileSizeDisplay = document.getElementById("fileSizeDisplay");
  const btnAnalyzeUploaded = document.getElementById("btnAnalyzeUploaded");

  // Result Elements
  const mainResultCard = document.getElementById("mainResultCard");
  const resultBadge = document.getElementById("resultBadge");
  const resultBadgeIcon = document.getElementById("resultBadgeIcon");
  const resultBadgeText = document.getElementById("resultBadgeText");
  const resultLabelBig = document.getElementById("resultLabelBig");
  const resultDescription = document.getElementById("resultDescription");
  const feedbackAlertBanner = document.getElementById("feedbackAlertBanner");
  const valProbBerisik = document.getElementById("valProbBerisik");
  const barProbBerisik = document.getElementById("barProbBerisik");
  const valProbNon = document.getElementById("valProbNon");
  const barProbNon = document.getElementById("barProbNon");
  const statDuration = document.getElementById("statDuration");
  const statSegments = document.getElementById("statSegments");
  const statRMS = document.getElementById("statRMS");
  const statFeedback = document.getElementById("statFeedback");
  const segmentCard = document.getElementById("segmentCard");
  const timelineVisual = document.getElementById("timelineVisual");
  const segmentsList = document.getElementById("segmentsList");

  // History Elements
  const historyTableBody = document.getElementById("historyTableBody");
  const historyCounter = document.getElementById("historyCounter");
  const btnClearHistory = document.getElementById("btnClearHistory");

  // State
  let isListening = false;
  let mediaStream = null;
  let audioContext = null;
  let analyser = null;
  let animFrameId = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let chunkTimer = null;
  let progressTimer = null;
  let lastFeedbackPlayedAt = 0;
  let detectionCount = 0;
  let selectedFile = null;

  // Set initial feedback volume
  if (feedbackAudio) {
    feedbackAudio.volume = parseFloat(feedbackVolume.value);
  }

  // --- TAB SWITCHING ---
  tabMicBtn.addEventListener("click", () => {
    tabMicBtn.classList.add("active");
    tabFileBtn.classList.remove("active");
    micTab.classList.add("active");
    fileTab.classList.remove("active");
  });

  tabFileBtn.addEventListener("click", () => {
    tabFileBtn.classList.add("active");
    tabMicBtn.classList.remove("active");
    fileTab.classList.add("active");
    micTab.classList.remove("active");
    if (isListening) stopMicrophone();
  });

  // --- FEEDBACK AUDIO CONTROLS ---
  feedbackVolume.addEventListener("input", (e) => {
    feedbackAudio.volume = parseFloat(e.target.value);
  });

  btnTestNotif.addEventListener("click", () => {
    playFeedbackAudio("manual");
  });

  function playFeedbackAudio(reason = "auto") {
    if (!toggleFeedback.checked && reason === "auto") {
      return false;
    }
    const cooldownMs = parseInt(feedbackCooldownSelect.value);
    const now = Date.now();
    if (reason === "auto" && (now - lastFeedbackPlayedAt < cooldownMs)) {
      return false; // In cooldown
    }

    feedbackAudio.currentTime = 0;
    feedbackAudio.play().then(() => {
      lastFeedbackPlayedAt = Date.now();
      showFeedbackAlertVisual();
    }).catch(err => {
      console.warn("Gagal memutar feedback audio:", err);
    });
    return true;
  }

  function showFeedbackAlertVisual() {
    feedbackAlertBanner.classList.add("active");
    setTimeout(() => {
      feedbackAlertBanner.classList.remove("active");
    }, 3500);
  }

  // --- AUDIO VISUALIZER ---
  const canvasCtx = visualizerCanvas.getContext("2d");

  function drawVisualizer() {
    if (!analyser) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    canvasCtx.fillStyle = "#080c14";
    canvasCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

    canvasCtx.lineWidth = 2.5;
    // Dynamic color based on classification state
    if (mainResultCard.classList.contains("state-berisik")) {
      canvasCtx.strokeStyle = "#f43f5e";
      canvasCtx.shadowColor = "#f43f5e";
      canvasCtx.shadowBlur = 12;
    } else {
      canvasCtx.strokeStyle = "#06b6d4";
      canvasCtx.shadowColor = "#06b6d4";
      canvasCtx.shadowBlur = 8;
    }

    canvasCtx.beginPath();
    const sliceWidth = (visualizerCanvas.width * 1.0) / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * visualizerCanvas.height) / 2;

      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    canvasCtx.lineTo(visualizerCanvas.width, visualizerCanvas.height / 2);
    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0;

    animFrameId = requestAnimationFrame(drawVisualizer);
  }

  function clearVisualizer() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    canvasCtx.fillStyle = "#080c14";
    canvasCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    visualizerOverlay.style.display = "flex";
  }

  // --- MICROPHONE CAPTURE ---
  btnToggleMic.addEventListener("click", () => {
    if (!isListening) {
      startMicrophone();
    } else {
      stopMicrophone();
    }
  });

  async function startMicrophone() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      });

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(mediaStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      visualizerOverlay.style.display = "none";
      drawVisualizer();

      isListening = true;
      btnToggleMic.classList.add("recording");
      micMainIcon.className = "fa-solid fa-stop";
      micBtnMainText.textContent = "Hentikan Deteksi";
      micBtnSubText.textContent = "Mikrofon sedang aktif menganalisis suara...";
      listeningBar.style.display = "flex";

      startChunkRecording();
    } catch (err) {
      console.error("Gagal mengakses mikrofon:", err);
      alert("Tidak dapat mengakses mikrofon. Pastikan Anda memberikan izin akses mikrofon di browser.");
    }
  }

  function stopMicrophone() {
    isListening = false;
    btnToggleMic.classList.remove("recording");
    micMainIcon.className = "fa-solid fa-microphone";
    micBtnMainText.textContent = "Mulai Deteksi Mikrofon";
    micBtnSubText.textContent = "Klik untuk mulai mendengarkan lingkungan";
    listeningBar.style.display = "none";

    if (chunkTimer) clearInterval(chunkTimer);
    if (progressTimer) clearInterval(progressTimer);
    chunkProgress.style.width = "0%";

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }
    if (audioContext && audioContext.state !== "closed") {
      audioContext.close();
      audioContext = null;
    }
    clearVisualizer();
  }

  function startChunkRecording() {
    if (!isListening || !mediaStream) return;

    const intervalMs = parseInt(selectInterval.value) || 5000;
    let mimeType = "audio/webm";
    if (!MediaRecorder.isTypeSupported("audio/webm")) {
      mimeType = MediaRecorder.isTypeSupported("audio/ogg") ? "audio/ogg" : "";
    }

    function recordOneChunk() {
      if (!isListening) return;

      recordedChunks = [];
      try {
        mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
      } catch (e) {
        mediaRecorder = new MediaRecorder(mediaStream);
      }

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (recordedChunks.length > 0) {
          const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
          sendAudioForPrediction(blob, "Mikrofon (Live)");
        }
        if (isListening) {
          recordOneChunk();
        }
      };

      mediaRecorder.start();

      // Progress animation
      const startTime = Date.now();
      if (progressTimer) clearInterval(progressTimer);
      chunkProgress.style.width = "0%";
      progressTimer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const pct = Math.min(100, (elapsed / intervalMs) * 100);
        chunkProgress.style.width = `${pct}%`;
      }, 50);

      setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === "recording") {
          mediaRecorder.stop();
        }
      }, intervalMs);
    }

    recordOneChunk();
  }

  // --- SEND AUDIO PREDICTION ---
  async function sendAudioForPrediction(blobOrFile, sourceName = "Mikrofon") {
    setAnalyzingState(true);

    const formData = new FormData();
    const filename = (blobOrFile instanceof File) ? blobOrFile.name : `mic_${Date.now()}.webm`;
    formData.append("file", blobOrFile, filename);

    try {
      const response = await fetch("/api/predict", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({ detail: "Network error" }));
        throw new Error(errJson.detail || `Server error ${response.status}`);
      }

      const data = await response.json();
      displayPredictionResult(data, sourceName);
    } catch (err) {
      console.error("Prediksi gagal:", err);
      resultBadgeText.textContent = "ERROR";
      resultBadge.className = "card-status-badge badge-standby";
      resultDescription.textContent = `Kesalahan: ${err.message}`;
    } finally {
      setAnalyzingState(false);
    }
  }

  function setAnalyzingState(isAnalyzing) {
    if (isAnalyzing) {
      resultBadgeIcon.style.display = "inline-block";
      resultBadgeText.textContent = "MENGANALISIS...";
    } else {
      resultBadgeIcon.style.display = "none";
    }
  }

  // --- DISPLAY RESULTS & TRIGGER NOTIF FEEDBACK ---
  function displayPredictionResult(data, sourceName) {
    const isBerisik = data.is_berisik;
    const probBerisikPct = Math.round(data.confidence_berisik * 100);
    const probNonPct = Math.round(data.confidence_non_berisik * 100);

    // Update Card Class & Badge
    mainResultCard.classList.remove("state-berisik", "state-non-berisik");
    resultBadge.classList.remove("badge-standby", "badge-berisik", "badge-non-berisik");

    let feedbackStatusText = "Tidak dimainkan";

    if (isBerisik) {
      mainResultCard.classList.add("state-berisik");
      resultBadge.classList.add("badge-berisik");
      resultBadgeText.textContent = "⚠️ KEBISINGAN TERDETEKSI";
      resultLabelBig.textContent = "BERISIK";
      resultDescription.textContent = `Model mendeteksi pola suara berisik dengan keyakinan ${probBerisikPct}%.`;

      // Trigger notif.mp3 feedback!
      const played = playFeedbackAudio("auto");
      feedbackStatusText = played ? "Diputar (notif.mp3)" : "Cooldown / Muted";
      statFeedback.textContent = played ? "🔔 Diputar" : "Teredam";
      statFeedback.style.color = "#f43f5e";
    } else {
      mainResultCard.classList.add("state-non-berisik");
      resultBadge.classList.add("badge-non-berisik");
      resultBadgeText.textContent = "✅ KONDISI TENANG";
      resultLabelBig.textContent = "NON-BERISIK";
      resultDescription.textContent = `Suara lingkungan tergolong normal/tenang dengan probabilitas ${probNonPct}%.`;
      statFeedback.textContent = "Aman";
      statFeedback.style.color = "#10b981";
    }

    // Probability Bars
    valProbBerisik.textContent = `${probBerisikPct}%`;
    barProbBerisik.style.width = `${probBerisikPct}%`;
    valProbNon.textContent = `${probNonPct}%`;
    barProbNon.style.width = `${probNonPct}%`;

    // Stats Grid
    statDuration.textContent = `${data.duration_seconds}s`;
    statSegments.textContent = `${data.total_segments} segmen`;
    statRMS.textContent = (data.rms_level * 100).toFixed(2);

    // Segment Timeline Breakdown
    renderSegments(data.segments);

    // Add to History
    addHistoryRecord({
      time: new Date().toLocaleTimeString("id-ID"),
      source: sourceName,
      prediction: isBerisik ? "BERISIK" : "NON-BERISIK",
      isBerisik: isBerisik,
      probBerisik: `${probBerisikPct}%`,
      duration: `${data.duration_seconds}s`,
      feedbackStatus: feedbackStatusText
    });
  }

  function renderSegments(segments) {
    if (!segments || segments.length === 0) {
      segmentCard.style.display = "none";
      return;
    }

    segmentCard.style.display = "flex";
    timelineVisual.innerHTML = "";
    segmentsList.innerHTML = "";

    segments.forEach(seg => {
      // Visual bar slice
      const slice = document.createElement("div");
      slice.className = `timeline-slice ${seg.prediction}`;
      slice.title = `Segmen ${seg.segment_number}: ${seg.start_time}s - ${seg.end_time}s (${seg.label_display})`;
      slice.textContent = `${seg.segment_number}`;
      timelineVisual.appendChild(slice);

      // Pill in list
      const pill = document.createElement("div");
      pill.className = `seg-badge ${seg.prediction}`;
      pill.innerHTML = `
        <strong>#${seg.segment_number} (${seg.start_time}-${seg.end_time}s)</strong>
        <span>${seg.label_display} (${Math.round(seg.probability_berisik * 100)}%)</span>
      `;
      segmentsList.appendChild(pill);
    });
  }

  // --- HISTORY MANAGEMENT ---
  function addHistoryRecord(record) {
    detectionCount++;
    historyCounter.textContent = `${detectionCount} deteksi tercatat`;

    const emptyRow = historyTableBody.querySelector(".empty-row");
    if (emptyRow) emptyRow.remove();

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${record.time}</td>
      <td><strong>${record.source}</strong></td>
      <td>
        <span class="card-status-badge ${record.isBerisik ? 'badge-berisik' : 'badge-non-berisik'}" style="padding: 2px 8px; display: inline-flex;">
          ${record.prediction}
        </span>
      </td>
      <td>${record.probBerisik}</td>
      <td>${record.duration}</td>
      <td>${record.feedbackStatus}</td>
    `;

    historyTableBody.insertBefore(tr, historyTableBody.firstChild);

    // Limit to 20 rows
    while (historyTableBody.children.length > 20) {
      historyTableBody.removeChild(historyTableBody.lastChild);
    }
  }

  btnClearHistory.addEventListener("click", () => {
    detectionCount = 0;
    historyCounter.textContent = "0 deteksi tercatat";
    historyTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">Belum ada riwayat aktivitas. Nyalakan mikrofon atau uji file audio.</td>
      </tr>
    `;
  });

  // --- FILE UPLOAD HANDLERS ---
  btnBrowseFile.addEventListener("click", () => {
    audioFileInput.click();
  });

  audioFileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleSelectedFile(e.target.files[0]);
    }
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });

  function handleSelectedFile(file) {
    selectedFile = file;
    fileNameDisplay.textContent = file.name;
    const kb = (file.size / 1024).toFixed(1);
    fileSizeDisplay.textContent = `(${kb} KB)`;
    fileUploadInfo.style.display = "flex";
  }

  btnAnalyzeUploaded.addEventListener("click", () => {
    if (selectedFile) {
      sendAudioForPrediction(selectedFile, `File: ${selectedFile.name}`);
    }
  });

  // --- QUICK TEST WITH cobasuara1.mp3 ---
  btnTestCobasuara.addEventListener("click", async () => {
    setAnalyzingState(true);
    try {
      const res = await fetch("/api/test-sample");
      if (!res.ok) throw new Error("Gagal menguji file cobasuara1.mp3");
      const data = await res.json();
      displayPredictionResult(data, "Sample: cobasuara1.mp3");
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setAnalyzingState(false);
    }
  });
});
