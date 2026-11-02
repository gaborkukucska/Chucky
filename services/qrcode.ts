// A small QR code maker (no packages needed): byte mode, error correction level M,
// versions 1-10 (up to 213 bytes - plenty for an invite link). Follows the QR code
// standard (ISO/IEC 18004): data + Reed-Solomon error correction, function patterns,
// zig-zag placement, the best of the 8 masks, format and version information.
//
//   makeQr('http://192.168.1.5:3000/?join=BARK-27')  ->  boolean[][] (true = dark), no margin
//
// Scanners need a light margin of 4 modules around it (the SVG in InviteQR.tsx adds it).

// Per version (index 1-10), level M: [error correction codewords per block, blocks in
// group 1, data codewords per group-1 block, blocks in group 2, data codewords per group-2 block]
const BLOCKS_M: [number, number, number, number, number][] = [
    [0, 0, 0, 0, 0],
    [10, 1, 16, 0, 0],
    [16, 1, 28, 0, 0],
    [26, 1, 44, 0, 0],
    [18, 2, 32, 0, 0],
    [24, 2, 43, 0, 0],
    [16, 4, 27, 0, 0],
    [18, 4, 31, 0, 0],
    [22, 2, 38, 2, 39],
    [22, 3, 36, 2, 37],
    [26, 4, 43, 1, 44],
];
// Centres of the alignment patterns per version
const ALIGNMENT: number[][] = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];
const MAX_VERSION = 10;
const FORMAT_BITS_M = 0; // Level M's 2-bit code in the format information

// ---------------------------------------------------------------------------
// Reed-Solomon over GF(256), polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D)
// ---------------------------------------------------------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Generator polynomial of the given degree, highest power first (leading 1 included) */
const rsGenerator = (degree: number) => {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
        const next = new Array(poly.length + 1).fill(0);
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= poly[j];                   // * x
            next[j + 1] ^= gfMul(poly[j], EXP[i]); // * alpha^i
        }
        poly = next;
    }
    return poly;
};

/** The error correction codewords for one block of data */
const rsRemainder = (data: number[], degree: number) => {
    const gen = rsGenerator(degree);
    const rem = new Array(degree).fill(0);
    for (const b of data) {
        const factor = b ^ (rem.shift() as number);
        rem.push(0);
        for (let j = 0; j < degree; j++) rem[j] ^= gfMul(gen[j + 1], factor);
    }
    return rem;
};

// ---------------------------------------------------------------------------
// Data: mode, length, bytes, terminator, padding - then split, corrected, interleaved
// ---------------------------------------------------------------------------
const utf8 = (text: string) => Array.from(new TextEncoder().encode(text));

const dataCapacity = (version: number) => {
    const [, g1, d1, g2, d2] = BLOCKS_M[version];
    return g1 * d1 + g2 * d2;
};

const encodeData = (bytes: number[], version: number) => {
    const bits: number[] = [];
    const put = (value: number, length: number) => {
        for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };
    put(0b0100, 4);                              // Byte mode
    put(bytes.length, version <= 9 ? 8 : 16);    // Character count
    bytes.forEach(b => put(b, 8));
    const capacityBits = dataCapacity(version) * 8;
    put(0, Math.min(4, capacityBits - bits.length)); // Terminator
    while (bits.length % 8) bits.push(0);
    const codewords: number[] = [];
    for (let i = 0; i < bits.length; i += 8) {
        let v = 0;
        for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
        codewords.push(v);
    }
    for (let pad = 0xec; codewords.length < dataCapacity(version); pad ^= 0xec ^ 0x11) codewords.push(pad);
    return codewords;
};

const addErrorCorrection = (data: number[], version: number) => {
    const [ec, g1, d1, g2, d2] = BLOCKS_M[version];
    const blocks: number[][] = [];
    const ecBlocks: number[][] = [];
    let k = 0;
    for (let b = 0; b < g1 + g2; b++) {
        const len = b < g1 ? d1 : d2;
        const block = data.slice(k, k + len);
        k += len;
        blocks.push(block);
        ecBlocks.push(rsRemainder(block, ec));
    }
    // Interleave: the i-th codeword of every block, then the error correction the same way
    const out: number[] = [];
    const longest = Math.max(d1, d2);
    for (let i = 0; i < longest; i++) for (const block of blocks) if (i < block.length) out.push(block[i]);
    for (let i = 0; i < ec; i++) for (const block of ecBlocks) out.push(block[i]);
    return out;
};

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------
class Grid {
    size: number;
    dark: boolean[][];
    fixed: boolean[][]; // Function patterns (not data, not masked)

    constructor(public version: number) {
        this.size = version * 4 + 17;
        this.dark = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
        this.fixed = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    }

    /** x = column, y = row */
    set(x: number, y: number, dark: boolean) {
        this.dark[y][x] = dark;
        this.fixed[y][x] = true;
    }

    drawFunctionPatterns() {
        const n = this.size;
        // Timing patterns
        for (let i = 0; i < n; i++) {
            this.set(6, i, i % 2 === 0);
            this.set(i, 6, i % 2 === 0);
        }
        // Finder patterns (with their light separators)
        for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) {
            for (let dy = -4; dy <= 4; dy++) {
                for (let dx = -4; dx <= 4; dx++) {
                    const x = cx + dx, y = cy + dy;
                    if (x < 0 || y < 0 || x >= n || y >= n) continue;
                    const d = Math.max(Math.abs(dx), Math.abs(dy));
                    this.set(x, y, d !== 2 && d !== 4);
                }
            }
        }
        // Alignment patterns (not on top of the finders)
        const pos = ALIGNMENT[this.version];
        const last = pos.length - 1;
        for (let i = 0; i <= last; i++) {
            for (let j = 0; j <= last; j++) {
                if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        this.set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
                    }
                }
            }
        }
        this.drawFormat(0); // Reserves the format areas (redrawn with the chosen mask)
        this.drawVersion();
    }

    /** Format information: level + mask, BCH-protected, in two copies; plus the dark module */
    drawFormat(mask: number) {
        const n = this.size;
        const data = (FORMAT_BITS_M << 3) | mask;
        let rem = data;
        for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        const bits = ((data << 10) | rem) ^ 0x5412;
        const bit = (i: number) => ((bits >>> i) & 1) === 1;
        for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
        this.set(8, 7, bit(6));
        this.set(8, 8, bit(7));
        this.set(7, 8, bit(8));
        for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
        for (let i = 0; i < 8; i++) this.set(n - 1 - i, 8, bit(i));
        for (let i = 8; i < 15; i++) this.set(8, n - 15 + i, bit(i));
        this.set(8, n - 8, true); // Always dark
    }

    /** Version information (versions 7+), in two copies */
    drawVersion() {
        if (this.version < 7) return;
        let rem = this.version;
        for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
        const bits = (this.version << 12) | rem;
        for (let i = 0; i < 18; i++) {
            const dark = ((bits >>> i) & 1) === 1;
            const a = this.size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            this.set(a, b, dark);
            this.set(b, a, dark);
        }
    }

    /** Codewords into the free modules: two columns at a time, zig-zagging up and down */
    drawCodewords(codewords: number[]) {
        const n = this.size;
        let i = 0;
        for (let right = n - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5; // Skip the vertical timing pattern
            for (let vert = 0; vert < n; vert++) {
                for (let j = 0; j < 2; j++) {
                    const x = right - j;
                    const upward = ((right + 1) & 2) === 0;
                    const y = upward ? n - 1 - vert : vert;
                    if (this.fixed[y][x]) continue;
                    if (i < codewords.length * 8) {
                        this.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
                        i++;
                    } // Leftover remainder bits stay light (0)
                }
            }
        }
    }

    applyMask(mask: number) {
        const n = this.size;
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (this.fixed[y][x]) continue;
                let flip: boolean;
                switch (mask) {
                    case 0: flip = (x + y) % 2 === 0; break;
                    case 1: flip = y % 2 === 0; break;
                    case 2: flip = x % 3 === 0; break;
                    case 3: flip = (x + y) % 3 === 0; break;
                    case 4: flip = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
                    case 5: flip = ((x * y) % 2) + ((x * y) % 3) === 0; break;
                    case 6: flip = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
                    default: flip = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
                }
                if (flip) this.dark[y][x] = !this.dark[y][x];
            }
        }
    }

    /** The standard penalty score: lower = easier to scan */
    penalty() {
        const n = this.size;
        const d = this.dark;
        let score = 0;
        const line = (get: (i: number) => boolean) => {
            // Runs of 5+ of the same colour
            let run = 1;
            for (let i = 1; i <= n; i++) {
                if (i < n && get(i) === get(i - 1)) run++;
                else {
                    if (run >= 5) score += 3 + (run - 5);
                    run = 1;
                }
            }
            // Finder-like 1:1:3:1:1 patterns with 4 light modules on one side
            for (let i = 0; i + 10 < n; i++) {
                const p = [true, false, true, true, true, false, true];
                const core = p.every((v, k) => get(i + k) === v);
                const coreLater = p.every((v, k) => get(i + 4 + k) === v);
                if (core && [7, 8, 9, 10].every(k => !get(i + k))) score += 40;
                if (coreLater && [0, 1, 2, 3].every(k => !get(i + k))) score += 40;
            }
        };
        for (let y = 0; y < n; y++) line(i => d[y][i]);
        for (let x = 0; x < n; x++) line(i => d[i][x]);
        // 2x2 blocks of one colour
        for (let y = 0; y + 1 < n; y++) {
            for (let x = 0; x + 1 < n; x++) {
                const c = d[y][x];
                if (c === d[y][x + 1] && c === d[y + 1][x] && c === d[y + 1][x + 1]) score += 3;
            }
        }
        // Balance of dark and light
        let darkCount = 0;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (d[y][x]) darkCount++;
        const percent = (darkCount * 100) / (n * n);
        score += Math.floor(Math.abs(percent - 50) / 5) * 10;
        return score;
    }
}

/** The QR code for `text` as rows of modules (true = dark). Throws if the text is too long. */
export const makeQr = (text: string): boolean[][] => {
    const bytes = utf8(text);
    let version = 1;
    while (version <= MAX_VERSION) {
        const headerBits = 4 + (version <= 9 ? 8 : 16);
        if (headerBits + bytes.length * 8 <= dataCapacity(version) * 8) break;
        version++;
    }
    if (version > MAX_VERSION) throw new Error('Text too long for this QR code maker');
    const codewords = addErrorCorrection(encodeData(bytes, version), version);

    // Try every mask, keep the one that scores best
    let best: Grid | null = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
        const grid = new Grid(version);
        grid.drawFunctionPatterns();
        grid.drawCodewords(codewords);
        grid.applyMask(mask);
        grid.drawFormat(mask);
        const score = grid.penalty();
        if (score < bestScore) {
            bestScore = score;
            best = grid;
        }
    }
    return best!.dark;
};
