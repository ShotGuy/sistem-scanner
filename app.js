/**
 * Logika Aplikasi Utama (Routing, Kamera, UI, dan Integrasi)
 */

// Registrasi Service Worker untuk PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker terdaftar successfully'))
      .catch(err => console.warn('Pendaftaran Service Worker gagal:', err));
  });
}

// State Global Aplikasi
const state = {
  activeTab: 'generator',
  currentOriginalBits: null,
  stream: null,
  isScanning: false,
  berThreshold: 0.22, // Batas aman BER (di bawah ini dianggap ASLI)
  nccThreshold: 0.65, // Batas aman NCC (di atas ini dianggap ASLI)
};

// Elemen DOM
const el = {
  tabGen: document.getElementById('tab-gen'),
  tabScan: document.getElementById('tab-scan'),
  btnTabGen: document.getElementById('btn-tab-gen'),
  btnTabScan: document.getElementById('btn-tab-scan'),
  loadingOverlay: document.getElementById('loading-overlay'),
  
  // Generator
  formGen: document.getElementById('form-generator'),
  inputNama: document.getElementById('nama-obat'),
  inputNomor: document.getElementById('nomor-obat'),
  inputDataQR: document.getElementById('data-qr'),
  canvasGen: document.getElementById('canvas-generator'),
  btnDownload: document.getElementById('btn-download'),
  
  // Scanner / Verifikator
  video: document.getElementById('scanner-video'),
  fileInput: document.getElementById('file-input'),
  btnStartCamera: document.getElementById('btn-start-camera'),
  btnStopCamera: document.getElementById('btn-stop-camera'),
  scannerLine: document.querySelector('.scanner-line'),
  canvasWarped: document.getElementById('canvas-warped'),
  canvasCDPScan: document.getElementById('canvas-cdp-scan'),
  canvasCDPOrig: document.getElementById('canvas-cdp-orig'),
  
  // Metrik Hasil
  valQRText: document.getElementById('val-qr-text'),
  valBER: document.getElementById('val-ber'),
  valNCC: document.getElementById('val-ncc'),
  valStatus: document.getElementById('val-status'),
  
  // Sliders
  sliderBER: document.getElementById('slider-ber'),
  valSliderBER: document.getElementById('val-slider-ber'),
  sliderNCC: document.getElementById('slider-ncc'),
  valSliderNCC: document.getElementById('val-slider-ncc'),
};

// Deteksi Kesiapan OpenCV.js
function checkOpenCVReady() {
  if (typeof cv !== 'undefined' && cv.Mat) {
    el.loadingOverlay.style.opacity = 0;
    setTimeout(() => {
      el.loadingOverlay.style.display = 'none';
    }, 500);
  } else {
    setTimeout(checkOpenCVReady, 100);
  }
}
window.addEventListener('load', checkOpenCVReady);

// Navigasi Tab
el.btnTabGen.addEventListener('click', () => switchTab('generator'));
el.btnTabScan.addEventListener('click', () => switchTab('scanner'));

function switchTab(tabName) {
  state.activeTab = tabName;
  if (tabName === 'generator') {
    el.tabGen.classList.add('active');
    el.tabScan.classList.remove('active');
    el.btnTabGen.classList.add('active');
    el.btnTabScan.classList.remove('active');
    stopCamera();
  } else {
    el.tabGen.classList.remove('active');
    el.tabScan.classList.add('active');
    el.btnTabGen.classList.remove('active');
    el.btnTabScan.classList.add('active');
  }
}

// ==========================================
// SEKSI 1: LOGIKA GENERATOR LABEL
// ==========================================
el.formGen.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const nama = el.inputNama.value.trim();
  const nomor = el.inputNomor.value.trim();
  const textQR = el.inputDataQR.value.trim();
  
  if (!nama || !nomor || !textQR) {
    alert("Harap isi semua kolom input!");
    return;
  }
  
  try {
    // 1. Bangkitkan deretan bit random CDP (63x63 = 3969 bit)
    const bits = await generateCDPBitstream(nama, nomor, 3969);
    state.currentOriginalBits = bits;
    
    // Format data terstruktur di dalam QR Code agar scanner bisa mendeteksi parameters otomatis
    // Format: SECURE-DRUG|NAMA:xxx|NOMOR:yyy|DATA:zzz
    const structuredQRData = `SECURE-DRUG|NAMA:${nama}|NOMOR:${nomor}|DATA:${textQR}`;
    
    // 2. Generate QR Code dasar pada canvas virtual
    const tempDiv = document.createElement('div');
    new QRCode(tempDiv, {
      text: structuredQRData,
      width: 462,
      height: 462,
      correctLevel: QRCode.CorrectLevel.H // Wajib High Error Correction (30%)
    });
    
    // Tunggu qrcode.js selesai menggambar ke canvas
    setTimeout(() => {
      const qrCanvas = tempDiv.querySelector('canvas');
      if (!qrCanvas) {
        alert("Gagal merender QR Code.");
        return;
      }
      
      const ctxFinal = el.canvasGen.getContext('2d');
      el.canvasGen.width = 462;
      el.canvasGen.height = 462;
      
      // Salin QR Code asli ke canvas utama
      ctxFinal.drawImage(qrCanvas, 0, 0);
      
      // 3. Bersihkan area tengah 9x9 modul QR Code (dari koordinat 168 ke 294)
      ctxFinal.fillStyle = "#FFFFFF";
      ctxFinal.fillRect(168, 168, 126, 126);
      
      // 4. Buat canvas temp untuk merender CDP digital
      const tempCDPCanvas = document.createElement('canvas');
      drawOriginalCDPToCanvas(bits, tempCDPCanvas);
      
      // 5. Tempel CDP digital ke tengah QR Code
      ctxFinal.drawImage(tempCDPCanvas, 168, 168);
      
      // Aktifkan tombol unduh
      el.btnDownload.style.display = 'inline-flex';
    }, 200);
    
  } catch (err) {
    console.error(err);
    alert("Terjadi kesalahan saat membangkitkan CDP.");
  }
});

// Download Hasil QR + CDP
el.btnDownload.addEventListener('click', () => {
  const dataURL = el.canvasGen.toDataURL('image/png');
  const link = document.createElement('a');
  link.download = `label-keamanan-${el.inputNama.value.replace(/\s+/g, '-').toLowerCase()}.png`;
  link.href = dataURL;
  link.click();
});

// ==========================================
// SEKSI 2: LOGIKA PEMINDAI / VERIFIKATOR
// ==========================================

// Slider Dinamis thresholding
el.sliderBER.addEventListener('input', (e) => {
  state.berThreshold = parseFloat(e.target.value);
  el.valSliderBER.textContent = state.berThreshold.toFixed(2);
});

el.sliderNCC.addEventListener('input', (e) => {
  state.nccThreshold = parseFloat(e.target.value);
  el.valSliderNCC.textContent = state.nccThreshold.toFixed(2);
});

// Mengaktifkan kamera video
el.btnStartCamera.addEventListener('click', startCamera);
el.btnStopCamera.addEventListener('click', stopCamera);

async function startCamera() {
  try {
    const constraints = {
      video: { facingMode: 'environment', width: { ideal: 1080 }, height: { ideal: 1080 } },
      audio: false
    };
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    el.video.srcObject = state.stream;
    el.video.play();
    state.isScanning = true;
    el.scannerLine.style.display = 'block';
    el.btnStartCamera.style.display = 'none';
    el.btnStopCamera.style.display = 'inline-flex';
    
    // Mulai loop pemrosesan video frame
    requestAnimationFrame(scanVideoFrame);
  } catch (err) {
    console.error("Gagal membuka kamera:", err);
    alert("Tidak dapat mengakses kamera. Pastikan memberikan izin kamera atau gunakan fitur Unggah Foto.");
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(track => track.stop());
    state.stream = null;
  }
  state.isScanning = false;
  el.scannerLine.style.display = 'none';
  el.btnStartCamera.style.display = 'inline-flex';
  el.btnStopCamera.style.display = 'none';
}

// Loop Pemrosesan Video Frame
async function scanVideoFrame() {
  if (!state.isScanning) return;
  
  if (el.video.readyState === el.video.HAVE_ENOUGH_DATA) {
    // 1. Gambar frame video ke canvas tersembunyi
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = el.video.videoWidth;
    tempCanvas.height = el.video.videoHeight;
    const ctx = tempCanvas.getContext('2d');
    ctx.drawImage(el.video, 0, 0, tempCanvas.width, tempCanvas.height);
    
    // 2. Gunakan jsQR untuk membaca QR Code
    const imgData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const qrCode = jsQR(imgData.data, imgData.width, imgData.height, {
      inversionAttempts: "dontInvert",
    });
    
    if (qrCode) {
      console.log("QR Code Terbaca:", qrCode.data);
      
      // Jika data QR Code berformat terstruktur kita
      if (qrCode.data.startsWith('SECURE-DRUG|')) {
        stopCamera(); // Hentikan kamera jika berhasil terbaca
        processVerification(tempCanvas, qrCode.data);
        return;
      }
    }
  }
  
  // Lanjutkan loop frame berikutnya
  if (state.isScanning) {
    requestAnimationFrame(scanVideoFrame);
  }
}

// Unggah Foto Alternatif
el.fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const ctx = tempCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      // Pindai data QR Code dari gambar statis
      const imgData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const qrCode = jsQR(imgData.data, imgData.width, imgData.height);
      
      if (qrCode && qrCode.data.startsWith('SECURE-DRUG|')) {
        processVerification(tempCanvas, qrCode.data);
      } else {
        // Jika pembacaan QR otomatis gagal, kita coba lakukan warping manual jika tetap ingin diproses
        // Namun demi kemudahan riset, infokan bahwa format QR tidak didukung / tidak terbaca
        alert("Gagal membaca QR Code keamanan obat dari gambar. Pastikan gambar cukup terang dan tajam!");
      }
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

// ==========================================
// SEKSI 3: PEMROSESAN AUTENTIKASI FINAL
// ==========================================
async function processVerification(srcCanvas, rawQRData) {
  // 1. Parsing informasi obat dari QR Code
  // Format: SECURE-DRUG|NAMA:xxx|NOMOR:yyy|DATA:zzz
  const parts = rawQRData.split('|');
  const nama = parts[1].replace('NAMA:', '');
  const nomor = parts[2].replace('NOMOR:', '');
  const dataTambahan = parts[3].replace('DATA:', '');
  
  el.valQRText.innerHTML = `
    <strong>Nama Obat:</strong> ${nama}<br>
    <strong>Nomor Bets:</strong> ${nomor}<br>
    <strong>Info Tambahan:</strong> <a href="${dataTambahan}" target="_blank">${dataTambahan}</a>
  `;
  
  // 2. Luruskan QR Code menggunakan OpenCV.js (Warp Perspective)
  // Menghasilkan canvas warped berukuran 462x462
  el.canvasWarped.width = 462;
  el.canvasWarped.height = 462;
  const warpSuccess = detectAndWarpQRCode(srcCanvas, el.canvasWarped);
  
  if (!warpSuccess) {
    alert("Gagal meluruskan QR Code. Silakan posisikan ulang kamera agar QR terlihat lurus dan penuh.");
    return;
  }
  
  // 3. Potong area CDP hasil scan (126x126)
  extractCDPCanvas(el.canvasWarped, el.canvasCDPScan);
  
  // 4. Bangkitkan CDP Original secara kriptografis berdasarkan info obat hasil deode
  const originalBits = await generateCDPBitstream(nama, nomor, 3969);
  
  // Gambar CDP Original ke kanvas pembanding
  drawOriginalCDPToCanvas(originalBits, el.canvasCDPOrig);
  
  // 5. Hitung Metrik Kemiripan (BER & NCC)
  const ber = calculateBER(originalBits, el.canvasCDPScan);
  const ncc = calculateNCC(originalBits, el.canvasCDPScan);
  
  // Tampilkan nilai metrik
  el.valBER.textContent = `${(ber * 100).toFixed(2)}%`;
  el.valNCC.textContent = ncc.toFixed(3);
  
  // 6. Keputusan Final Keaslian
  // Syarat Asli: BER di bawah threshold DAN NCC di atas threshold
  const isOriginal = (ber <= state.berThreshold) && (ncc >= state.nccThreshold);
  
  if (isOriginal) {
    el.valStatus.textContent = "ASLI (ORIGINAL DRUG)";
    el.valStatus.className = "metric-value status-safe";
  } else {
    el.valStatus.textContent = "PALSU (CLONED / COPY DETECTED)";
    el.valStatus.className = "metric-value status-danger";
  }
}
