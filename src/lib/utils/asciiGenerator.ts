/**
 * Pure ASCII art generation utilities.
 * Converts image pixel data into ASCII character grids.
 */

export interface AsciiGrid {
	chars: string[];
	cols: number;
	rows: number;
}

/**
 * Calculate ASCII grid dimensions from image dimensions and resolution.
 */
export function calcGridSize(
	imgWidth: number,
	imgHeight: number,
	resolution: number,
): { cols: number; rows: number } {
	return {
		cols: Math.floor(imgWidth / resolution),
		rows: Math.floor(imgHeight / (resolution * 1.8)),
	};
}

/**
 * Convert raw pixel data (RGBA) into an array of ASCII characters.
 * Pure function — no DOM or canvas dependency.
 */
export function pixelsToAscii(
	pixels: Uint8ClampedArray,
	cols: number,
	rows: number,
	charSet: string,
): string[] {
	const chars: string[] = [];

	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const i = (y * cols + x) * 4;
			const r = pixels[i];
			const g = pixels[i + 1];
			const b = pixels[i + 2];
			const a = pixels[i + 3];

			if (a < 128) {
				chars.push(" ");
			} else {
				const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
				const charIndex = Math.floor(brightness * (charSet.length - 1));
				chars.push(charSet[charIndex]);
			}
		}
	}

	return chars;
}

/**
 * Build the scramble character pool from a charSet.
 */
export function buildScramblePool(charSet: string): string {
	return `${charSet.replace(/\s/g, "")}!@#$%^&*<>[]{}`;
}

/**
 * Pick a random character from the scramble pool.
 */
export function getRandomChar(scramblePool: string): string {
	return scramblePool[Math.floor(Math.random() * scramblePool.length)];
}

/**
 * Create a shuffled array of non-space indices for the settle animation.
 * Returns indices in random order so characters "lock in" unpredictably.
 */
export function buildSettleOrder(chars: string[]): number[] {
	const indices: number[] = [];
	for (let i = 0; i < chars.length; i++) {
		if (chars[i] !== " ") {
			indices.push(i);
		}
	}
	// Fisher-Yates shuffle
	for (let i = indices.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[indices[i], indices[j]] = [indices[j], indices[i]];
	}
	return indices;
}

/**
 * Build a single animation frame's character array.
 * Settled indices show final chars, unsettled indices show random scramble chars.
 */
export function buildAnimationFrame(
	asciiChars: string[],
	settledIndices: Set<number>,
	scramblePool: string,
): string[] {
	const frame: string[] = [];
	for (let i = 0; i < asciiChars.length; i++) {
		if (asciiChars[i] === " ") {
			frame.push(" ");
		} else if (settledIndices.has(i)) {
			frame.push(asciiChars[i]);
		} else {
			frame.push(getRandomChar(scramblePool));
		}
	}
	return frame;
}
