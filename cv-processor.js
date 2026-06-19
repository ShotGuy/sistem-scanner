/**
 * Modul Pengolahan Citra OpenCV.js untuk Autentikasi CDP & QR Code
 */

/**
 * Fungsi untuk mendeteksi 3 Finder Pattern QR Code dan meluruskan citra
 * @param {HTMLCanvasElement} srcCanvas - Canvas input berisi foto QR Code
 * @param {HTMLCanvasElement} destCanvas - Canvas target untuk output warped QR (462x462)
 * @returns {boolean} - true jika berhasil mendeteksi dan meluruskan, false jika gagal
 */
function detectAndWarpQRCode(srcCanvas, destCanvas) {
  if (typeof cv === 'undefined') {
    console.error("OpenCV.js belum dimuat.");
    return false;
  }

  let src = cv.imread(srcCanvas);
  let gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  // Lakukan blur ringan untuk mengurangi noise
  let blurred = new cv.Mat();
  let ksize = new cv.Size(5, 5);
  cv.GaussianBlur(gray, blurred, ksize, 0, 0, cv.BORDER_DEFAULT);

  // Binarisasi menggunakan Adaptive Thresholding
  let thresh = new cv.Mat();
  cv.adaptiveThreshold(blurred, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 51, 4);

  // Temukan kontur dan hierarki konturnya
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(thresh, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

  let finderCenters = [];

  // Cari 3 kontur bersarang 3 tingkat (karakteristik Finder Pattern: kotak bersarang)
  // hierarchy menyimpan [next, previous, first_child, parent] untuk setiap kontur
  for (let i = 0; i < contours.size(); i++) {
    let k = i;
    let depth = 0;
    
    // Hitung kedalaman anak kontur bersarang
    while (hierarchy.intPtr(0, k)[2] >= 0) {
      k = hierarchy.intPtr(0, k)[2];
      depth++;
    }
    
    // Jika kontur bersarang minimal 2 tingkat di dalamnya (total 3 kontur)
    if (depth >= 2) {
      let cnt = contours.get(i);
      let rect = cv.minAreaRect(cnt);
      
      // Filter berdasarkan aspect ratio dan ukuran minimum agar terhindar dari noise
      let width = rect.size.width;
      let height = rect.size.height;
      let aspectRatio = Math.min(width, height) / Math.max(width, height);
      
      if (aspectRatio > 0.7 && width > 15 && height > 15) {
        // Hitung titik pusat Finder Pattern
        let center = rect.center;
        
        // Hindari duplikasi pusat yang sangat berdekatan
        let isDuplicate = false;
        for (let pt of finderCenters) {
          let dist = Math.hypot(pt.x - center.x, pt.y - center.y);
          if (dist < 20) {
            isDuplicate = true;
            break;
          }
        }
        
        if (!isDuplicate) {
          finderCenters.push(center);
        }
      }
    }
  }

  // Bersihkan memori OpenCV
  gray.delete();
  blurred.delete();
  thresh.delete();
  contours.delete();
  hierarchy.delete();

  // Kita harus mendeteksi tepat 3 Finder Pattern
  if (finderCenters.length !== 3) {
    console.warn(`Gagal mendeteksi QR Code secara akurat. Ditemukan ${finderCenters.length} Finder Pattern (dibutuhkan tepat 3).`);
    src.delete();
    return false;
  }

  // Tentukan posisi masing-masing Finder Pattern: Top-Left (TL), Top-Right (TR), dan Bottom-Left (BL)
  // Urutkan berdasarkan jarak antar titik
  let p0 = finderCenters[0];
  let p1 = finderCenters[1];
  let p2 = finderCenters[2];

  let d01 = Math.hypot(p0.x - p1.x, p0.y - p1.y);
  let d12 = Math.hypot(p1.x - p2.x, p1.y - p2.y);
  let d02 = Math.hypot(p0.x - p2.x, p0.y - p2.y);

  let tl, tr, bl;
  // Titik TL adalah titik sudut siku-siku, di mana dua sisi siku-sikunya adalah jarak terpendek
  // Jarak terpanjang adalah hipotenusa (sisi miring) antara TR dan BL
  if (d12 > d01 && d12 > d02) {
    tl = p0; tr = p1; bl = p2;
  } else if (d02 > d01 && d02 > d12) {
    tl = p1; tr = p0; bl = p2;
  } else {
    tl = p2; tr = p0; bl = p1;
  }

  // Tentukan arah orientasi (apakah tr dan bl tertukar) menggunakan cross product
  let vectorTR = { x: tr.x - tl.x, y: tr.y - tl.y };
  let vectorBL = { x: bl.x - tl.x, y: bl.y - tl.y };
  let crossProduct = vectorTR.x * vectorBL.y - vectorTR.y * vectorBL.x;
  
  if (crossProduct < 0) {
    // Tukar TR dan BL agar searah jarum jam (TR di kanan atas, BL di kiri bawah)
    let temp = tr;
    tr = bl;
    bl = temp;
  }

  // Estimasi titik sudut ke-4 (Bottom-Right) secara geometris
  let br = {
    x: tr.x + bl.x - tl.x,
    y: tr.y + bl.y - tl.y
  };

  // Lakukan Warp Perspective ke ukuran target 462x462 piksel
  let srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
    tl.x, tl.y,
    tr.x, tr.y,
    br.x, br.y,
    bl.x, bl.y
  ]);

  let destCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    462, 0,
    462, 462,
    0, 462
  ]);

  let M = cv.getPerspectiveTransform(srcCoords, destCoords);
  let dsize = new cv.Size(462, 462);
  let warped = new cv.Mat();
  
  cv.warpPerspective(src, warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
  cv.imshow(destCanvas, warped);

  // Bersihkan sisa memori
  src.delete();
  srcCoords.delete();
  destCoords.delete();
  M.delete();
  warped.delete();

  return true;
}

/**
 * Memotong area CDP (126x126 piksel) dari tengah QR Code (462x462 piksel)
 * Koordinat area tengah: [168, 168] sampai [294, 294]
 */
function extractCDPCanvas(warpedCanvas, cdpCanvas) {
  let ctxWarped = warpedCanvas.getContext('2d');
  let ctxCDP = cdpCanvas.getContext('2d');
  
  cdpCanvas.width = 126;
  cdpCanvas.height = 126;
  
  // Ambil data piksel area tengah
  ctxCDP.drawImage(warpedCanvas, 168, 168, 126, 126, 0, 0, 126, 126);
}

/**
 * Menghitung Bit Error Rate (BER) dengan penyelarasan mikro (micro-alignment)
 * @param {Array<number>} originalBits - Array 3.969 bit (0 dan 1)
 * @param {HTMLCanvasElement} scanCDPCanvas - Canvas berisi citra CDP hasil potong kamera (126x126)
 * @returns {number} - Nilai BER terbaik (persentase error dalam desimal: 0.0 - 1.0)
 */
function calculateBER(originalBits, scanCDPCanvas) {
  let src = cv.imread(scanCDPCanvas);
  let gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  // Gunakan Otsu's Thresholding untuk binarisasi citra scan menjadi hitam-putih murni
  let thresh = new cv.Mat();
  cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);

  let bestBER = 1.0;

  // Lakukan pencarian pergeseran mikro (X: -3 s/d 3 px, Y: -3 s/d 3 px)
  // guna mengatasi ketidaksempurnaan sub-piksel dari proses warping
  for (let offsetY = -3; offsetY <= 3; offsetY++) {
    for (let offsetX = -3; offsetX <= 3; offsetX++) {
      let errorCount = 0;
      
      // Bandingkan matriks 63x63 bit
      for (let y = 0; y < 63; y++) {
        for (let x = 0; x < 63; x++) {
          const origBit = originalBits[y * 63 + x];
          
          // Koordinat piksel digital CDP: 1 bit CDP direpresentasikan oleh 2x2 piksel
          // Kita ambil sampel nilai piksel di pusat blok 2x2 dengan offset pergeseran
          const pixelX = x * 2 + 1 + offsetX;
          const pixelY = y * 2 + 1 + offsetY;
          
          let scanBit = 1; // Default putih
          
          if (pixelX >= 0 && pixelX < 126 && pixelY >= 0 && pixelY < 126) {
            // Pada citra biner OpenCV: 0 = hitam, 255 = putih
            const pixelValue = thresh.ucharAt(pixelY, pixelX);
            scanBit = pixelValue < 127 ? 1 : 0; // Bit 1 = Hitam, Bit 0 = Putih
          }
          
          if (scanBit !== origBit) {
            errorCount++;
          }
        }
      }
      
      const currentBER = errorCount / 3969;
      if (currentBER < bestBER) {
        bestBER = currentBER;
      }
    }
  }

  // Bersihkan memori
  src.delete();
  gray.delete();
  thresh.delete();

  return bestBER;
}

/**
 * Menghitung Normalized Cross-Correlation (NCC) antara grayscale scan dan original
 * @param {Array<number>} originalBits - Array 3.969 bit (0 dan 1)
 * @param {HTMLCanvasElement} scanCDPCanvas - Canvas berisi citra CDP hasil potong kamera (126x126)
 * @returns {number} - Nilai NCC (0.0 s/d 1.0)
 */
function calculateNCC(originalBits, scanCDPCanvas) {
  // 1. Rekonstruksi citra original ke dalam representasi matriks grayscale 126x126 piksel
  let origData = new Uint8Array(126 * 126);
  for (let y = 0; y < 63; y++) {
    for (let x = 0; x < 63; x++) {
      const bit = originalBits[y * 63 + x];
      const val = bit === 1 ? 0 : 255; // 0 = hitam, 255 = putih
      
      // Isi blok 2x2 piksel
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          origData[(y * 2 + dy) * 126 + (x * 2 + dx)] = val;
        }
      }
    }
  }

  // 2. Ambil citra scan dalam format grayscale
  let src = cv.imread(scanCDPCanvas);
  let gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  // Buat Mat dari data original
  let origMat = cv.matFromArray(126, 126, cv.CV_8UC1, Array.from(origData));

  // Hitung rata-rata
  let meanOrig = cv.mean(origMat)[0];
  let meanScan = cv.mean(gray)[0];

  // Hitung deviasi & korelasi
  let sumNumerator = 0;
  let sumDenomOrig = 0;
  let sumDenomScan = 0;

  for (let y = 0; y < 126; y++) {
    for (let x = 0; x < 126; x++) {
      let valOrig = origMat.ucharAt(y, x) - meanOrig;
      let valScan = gray.ucharAt(y, x) - meanScan;

      sumNumerator += valOrig * valScan;
      sumDenomOrig += valOrig * valOrig;
      sumDenomScan += valScan * valScan;
    }
  }

  let ncc = 0;
  if (sumDenomOrig > 0 && sumDenomScan > 0) {
    ncc = sumNumerator / Math.sqrt(sumDenomOrig * sumDenomScan);
  }

  // Bersihkan memori OpenCV
  src.delete();
  gray.delete();
  origMat.delete();

  // Pastikan rentang nilai NCC berada pada 0 s/d 1
  return Math.max(0, ncc);
}

/**
 * Merender citra CDP original ke elemen Canvas untuk visualisasi perbandingan
 */
function drawOriginalCDPToCanvas(originalBits, canvas) {
  canvas.width = 126;
  canvas.height = 126;
  let ctx = canvas.getContext('2d');
  let imgData = ctx.createImageData(126, 126);
  
  for (let y = 0; y < 63; y++) {
    for (let x = 0; x < 63; x++) {
      const bit = originalBits[y * 63 + x];
      const color = bit === 1 ? 0 : 255; // Hitam (0) atau Putih (255)
      
      // Isi blok 2x2 piksel
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const pixelIndex = ((y * 2 + dy) * 126 + (x * 2 + dx)) * 4;
          imgData.data[pixelIndex] = color;     // R
          imgData.data[pixelIndex + 1] = color; // G
          imgData.data[pixelIndex + 2] = color; // B
          imgData.data[pixelIndex + 3] = 255;   // A
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Menghitung Shannon Entropy dari sebuah Canvas grayscale (8-bit)
 * @param {HTMLCanvasElement} canvas - Canvas yang berisi citra CDP (126x126)
 * @returns {number} - Nilai entropi shannon (0.0 s/d 8.0 untuk grayscale)
 */
function calculateShannonEntropy(canvas) {
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const totalPixels = canvas.width * canvas.height;
  
  // Hitung histogram tingkat keabuan (0-255)
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    // Rumus konversi luminansi grayscale standar: Y = 0.299R + 0.587G + 0.114B
    const r = data[i];
    const g = data[i+1];
    const b = data[i+2];
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    histogram[gray]++;
  }
  
  // Hitung Shannon Entropy
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (histogram[i] > 0) {
      const p = histogram[i] / totalPixels;
      entropy -= p * Math.log2(p);
    }
  }
  
  return entropy;
}

