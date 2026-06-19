/**
 * Modul Kriptografi & HMAC-DRBG untuk Copy Detection Pattern (CDP)
 * Berdasarkan adaptasi NIST SP 800-90A untuk CSPRNG deterministik berbasis browser
 */

const SECRET_KEY = "CDP_SECRET_KEY_FOR_PHARMA_SECURE_RESEARCH_2026";

/**
 * Fungsi pembantu untuk mengkonversi string menjadi ArrayBuffer
 */
function stringToArrayBuffer(str) {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

/**
 * Menghitung HMAC-SHA256 menggunakan Web Crypto API
 */
async function computeHMAC(keyBytes, dataBytes) {
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: { name: "SHA-256" } },
    false,
    ["sign"]
  );
  const signature = await window.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    dataBytes
  );
  return new Uint8Array(signature);
}

/**
 * Kelas HMAC-DRBG (Deterministic Random Bit Generator)
 */
class HMAC_DRBG {
  constructor() {
    this.key = new Uint8Array(32); // 256 bit Key, diinisialisasi 0x00
    this.v = new Uint8Array(32);   // 256 bit V, diinisialisasi 0x01
    this.v.fill(1);
  }

  /**
   * Mengupdate internal state Key dan V menggunakan provided data
   */
  async update(providedData = null) {
    // Langkah 1: Key = HMAC(Key, V || 0x00 || providedData)
    let tempLength = this.v.length + 1;
    if (providedData) tempLength += providedData.length;
    
    let tempData = new Uint8Array(tempLength);
    tempData.set(this.v, 0);
    tempData[this.v.length] = 0x00;
    if (providedData) {
      tempData.set(providedData, this.v.length + 1);
    }
    
    this.key = await computeHMAC(this.key, tempData);

    // Langkah 2: V = HMAC(Key, V)
    this.v = await computeHMAC(this.key, this.v);

    if (providedData) {
      // Langkah 3: Key = HMAC(Key, V || 0x01 || providedData)
      tempData = new Uint8Array(tempLength);
      tempData.set(this.v, 0);
      tempData[this.v.length] = 0x01;
      tempData.set(providedData, this.v.length + 1);
      
      this.key = await computeHMAC(this.key, tempData);
      
      // Langkah 4: V = HMAC(Key, V)
      this.v = await computeHMAC(this.key, this.v);
    }
  }

  /**
   * Menginisialisasi DRBG dengan Seed
   */
  async instantiate(seedBytes) {
    this.key.fill(0);
    this.v.fill(1);
    await this.update(seedBytes);
  }

  /**
   * Menghasilkan deretan byte random dengan panjang tertentu
   */
  async generate(numBytes) {
    let temp = new Uint8Array(0);
    
    while (temp.length < numBytes) {
      this.v = await computeHMAC(this.key, this.v);
      const nextTemp = new Uint8Array(temp.length + this.v.length);
      nextTemp.set(temp, 0);
      nextTemp.set(this.v, temp.length);
      temp = nextTemp;
    }
    
    const returnedBytes = temp.slice(0, numBytes);
    await this.update(null);
    return returnedBytes;
  }
}

/**
 * Fungsi utama untuk membangkitkan bit acak CDP berdasarkan parameter obat
 * Output: Array dengan nilai 0 atau 1 berukuran numBits
 */
async function generateCDPBitstream(namaObat, nomorObat, numBits) {
  // 1. Buat input gabungan
  const inputStr = `${namaObat.trim().toUpperCase()}|${nomorObat.trim().toUpperCase()}`;
  const inputBytes = stringToArrayBuffer(inputStr);
  const keyBytes = stringToArrayBuffer(SECRET_KEY);
  
  // 2. Hitung Seed awal = HMAC-SHA256(SecretKey, DataObat)
  const seed = await computeHMAC(keyBytes, inputBytes);
  
  // 3. Inisialisasi DRBG
  const drbg = new HMAC_DRBG();
  await drbg.instantiate(seed);
  
  // 4. Generate byte yang dibutuhkan
  const numBytesNeeded = Math.ceil(numBits / 8);
  const randomBytes = await drbg.generate(numBytesNeeded);
  
  // 5. Ubah byte menjadi deretan bit (0 dan 1)
  const bits = [];
  for (let i = 0; i < numBits; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    const bit = (randomBytes[byteIndex] >> (7 - bitIndex)) & 1;
    bits.push(bit);
  }
  
  return bits;
}
