import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

/** A one-shot reference capture, not a synchronization or application runtime. */
export async function captureHandbookPage(page, outputDirectory, key) {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error("Use a stable lowercase screen key");
	await page.evaluate(() => document.fonts.ready);
	const snapshot = await page.evaluate(() => {
		const decorativeAssets = [];
		const escapeHtml = (value) =>
			String(value)
				.replaceAll("&", "&amp;")
				.replaceAll('"', "&quot;")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;");
		const px = (value) => `${Math.round(value * 1000) / 1000}px`;
		const paint = [
			"backgroundColor",
			"backgroundImage",
			"backgroundSize",
			"backgroundPosition",
			"backgroundRepeat",
			"borderTop",
			"borderRight",
			"borderBottom",
			"borderLeft",
			"borderRadius",
			"boxShadow",
			"opacity",
			"mixBlendMode",
			"filter",
			"backdropFilter",
			"color",
			"fontFamily",
			"fontSize",
			"fontWeight",
			"fontStyle",
			"lineHeight",
			"letterSpacing",
			"textAlign",
			"textTransform",
			"textDecoration",
			"whiteSpace",
			"wordBreak",
			"overflowWrap",
			"textOverflow",
			"overflow",
			"zIndex",
		];
		const cssName = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
		const styleText = (style) =>
			Object.entries(style)
				.map(([name, value]) => `${cssName(name)}:${value}`)
				.join(";");
		const nameOf = (node) =>
			node.getAttribute("aria-label") ||
			node.id ||
			[...node.classList].filter((name) => !/^(svelte-|s-)/.test(name)).join(" ") ||
			node.tagName.toLowerCase();
		const visible = (node) => {
			const style = getComputedStyle(node);
			if (style.display === "contents") return [...node.children].some(visible);
			if (!node.checkVisibility()) return false;
			const rect = node.getBoundingClientRect();
			const painted =
				!["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "OPTION"].includes(node.tagName) &&
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				Number(style.opacity) > 0 &&
				style.clip !== "rect(0px, 0px, 0px, 0px)";
			if (!painted) return false;
			if (
				rect.width > 0 &&
				rect.height > 0 &&
				rect.right > 0 &&
				rect.bottom > 0 &&
				rect.left < innerWidth &&
				rect.top < innerHeight
			)
				return true;
			// Zero-sized navigation anchors deliberately paint absolutely positioned children.
			if (style.overflow === "visible" && [...node.children].some(visible)) return true;
			// A visible fixed purchase panel can belong to an offscreen flow slot.
			return [...node.querySelectorAll("*")].some(
				(child) => getComputedStyle(child).position === "fixed" && visible(child),
			);
		};
		const textLines = (node) => {
			const range = document.createRange();
			range.selectNodeContents(node);
			if (range.getClientRects().length <= 1)
				return [{ text: node.textContent, rect: range.getBoundingClientRect() }];
			const lines = [];
			let offset = 0;
			for (const character of node.textContent) {
				range.setStart(node, offset);
				offset += character.length;
				range.setEnd(node, offset);
				const bounds = [...range.getClientRects()].find(
					(rect) => rect.width > 0 && rect.height > 0,
				);
				let line = lines.at(-1);
				if (!bounds) {
					if (line && !/\s/.test(character)) line.text += character;
					continue;
				}
				if (!line || Math.abs(line.rect.top - bounds.top) > 0.5) {
					line = {
						text: "",
						rect: { left: bounds.left, top: bounds.top, width: 0, height: bounds.height },
					};
					lines.push(line);
				}
				line.text += character;
				line.rect.width = bounds.right - line.rect.left;
			}
			return lines;
		};
		const fragments = [];
		const limitations = [
			{
				element: "export",
				reason:
					"Draft editable markup only: pseudo-elements, native dialog backdrops, browser control chrome and text shaping require manual comparison. Offscreen content is omitted; capture complete components separately.",
			},
		];
		let nextKey = 0;
		const modalDialogs = [...document.querySelectorAll("dialog:modal")];
		function serialize(node, parentRect, split, parentKey = null) {
			if (getComputedStyle(node).display === "contents") {
				return [...node.children]
					.map((child) => serialize(child, parentRect, split, parentKey))
					.join("");
			}
			if (!visible(node)) return "";
			const rect = node.getBoundingClientRect();
			const computed = getComputedStyle(node);
			const modalIndex = modalDialogs.indexOf(node);
			if (
				computed.position === "fixed" &&
				node.matches('[role="dialog"][aria-modal="true"], .toast-container')
			) {
				// The shared admin modal covers the viewport, including host navigation.
				parentRect = { left: 0, top: 0 };
				parentKey = null;
				split = true;
			}
			if (modalIndex >= 0) {
				// Native top-layer dialogs escape ancestor clipping and ordinary z-index.
				parentRect = { left: 0, top: 0 };
				parentKey = null;
				split = true;
				const backdrop = getComputedStyle(node, "::backdrop");
				fragments.push({
					key: `fragment-${++nextKey}`,
					parentKey: null,
					name: "Native modal backdrop",
					childHtml: [],
					html: `<div layer-name="Native modal backdrop" style="position:absolute;left:0px;top:0px;width:${innerWidth}px;height:${innerHeight}px;z-index:${10000 + modalIndex * 2};background-color:${escapeHtml(backdrop.backgroundColor)};backdrop-filter:${escapeHtml(backdrop.backdropFilter)}"></div>`,
				});
			}
			const style = Object.fromEntries(paint.map((property) => [property, computed[property]]));
			if (modalIndex >= 0) style.zIndex = String(10001 + modalIndex * 2);
			Object.assign(style, {
				position: "absolute",
				left: px(rect.left - parentRect.left),
				top: px(rect.top - parentRect.top),
				width: px(rect.width),
				height: px(rect.height),
				margin: "0px",
				padding: "0px",
				boxSizing: "border-box",
				flexShrink: "0",
			});
			const name = nameOf(node);
			if (
				node.matches(".drag-handle > span") &&
				computed.backgroundImage.includes("radial-gradient") &&
				computed.backgroundSize === "6px 6px"
			) {
				style.backgroundImage = "none";
				const dots = Array.from(
					{ length: 6 },
					(_, index) =>
						`<div layer-name="Drag grip dot" style="position:absolute;left:${px((index % 2) * 6 + 1.7)};top:${px(Math.floor(index / 2) * 6 + 1.7)};width:2.6px;height:2.6px;border-radius:1.3px;background-color:${escapeHtml(computed.color)}"></div>`,
				).join("");
				return `<div layer-name="Drag grip" style="${escapeHtml(styleText(style))}">${dots}</div>`;
			}
			// Paper's line-clamp conversion can truncate a snug, already-fitting label.
			// Keep genuine browser truncation; otherwise preserve its single-line text.
			if (computed.whiteSpace === "nowrap" && node.scrollWidth <= node.clientWidth + 1) {
				style.whiteSpace = "pre";
				style.textOverflow = "clip";
				style.overflow = "visible";
			}
			if (node.tagName === "CANVAS") {
				if (node.matches(".grain-canvas[aria-hidden='true']")) {
					// The site's resize handler redraws its decorative WebGL buffer synchronously.
					window.dispatchEvent(new Event("resize"));
					const assetKey = `grain-${decorativeAssets.length}`;
					decorativeAssets.push({ key: assetKey, dataUrl: node.toDataURL("image/png") });
					limitations.push({
						element: name,
						reason:
							"Original decorative canvas captured as a static texture layer; live grain cadence remains a browser behavior.",
					});
					return `<img layer-name="Original film grain — static texture" src="handbook-canvas://${assetKey}" style="${escapeHtml(styleText(style))}"/>`;
				}
				limitations.push({
					element: name,
					reason:
						"Live canvas effect is not converted into editable layers. Consult the browser capture and source motion rules.",
				});
				return "";
			}
			if (node.tagName === "SVG" || node.tagName.toLowerCase() === "svg") {
				const clone = node.cloneNode(true);
				[node, ...node.querySelectorAll("*")].forEach((source, index) => {
					const target = [clone, ...clone.querySelectorAll("*")][index];
					const svgStyle = getComputedStyle(source);
					for (const property of [
						"fill",
						"stroke",
						"strokeWidth",
						"strokeLinecap",
						"strokeLinejoin",
						"fillOpacity",
						"strokeOpacity",
						"opacity",
					]) {
						target.setAttribute(cssName(property), svgStyle[property]);
						target.style.setProperty(cssName(property), svgStyle[property]);
					}
				});
				clone.setAttribute("style", `${styleText(style)};${clone.getAttribute("style") ?? ""}`);
				clone.setAttribute("layer-name", name);
				return clone.outerHTML;
			}
			if (node instanceof HTMLImageElement) {
				style.objectFit = computed.objectFit;
				style.objectPosition = computed.objectPosition;
				return `<img layer-name="${escapeHtml(name)}" src="${escapeHtml(node.currentSrc || node.src)}" alt="${escapeHtml(node.alt)}" style="${escapeHtml(styleText(style))}"/>`;
			}
			if (
				node instanceof HTMLInputElement ||
				node instanceof HTMLTextAreaElement ||
				node instanceof HTMLSelectElement
			) {
				let value =
					node instanceof HTMLSelectElement
						? (node.selectedOptions[0]?.textContent ?? "")
						: node.type === "password" && node.value
							? "•".repeat(node.value.length)
							: node.value || node.placeholder;
				if (node instanceof HTMLTextAreaElement && node.value) {
					// Textarea values have no DOM Range; measure an equivalent hidden text box.
					const mirror = document.createElement("div");
					Object.assign(mirror.style, {
						position: "fixed",
						visibility: "hidden",
						padding: "0px",
						border: "0px",
						width: px(
							node.clientWidth -
								Number.parseFloat(computed.paddingLeft) -
								Number.parseFloat(computed.paddingRight),
						),
						font: computed.font,
						letterSpacing: computed.letterSpacing,
						whiteSpace: "pre-wrap",
						overflowWrap: "break-word",
					});
					mirror.textContent = value;
					document.body.append(mirror);
					const lines = textLines(mirror.firstChild);
					const content = [];
					let previousTop;
					for (const line of lines) {
						if (previousTop !== undefined) {
							const blankLines =
								Math.round((line.rect.top - previousTop) / Number.parseFloat(computed.lineHeight)) -
								1;
							for (let index = 0; index < blankLines; index++) content.push("");
						}
						content.push(line.text.trimEnd());
						previousTop = line.rect.top;
					}
					value = content.join("\n");
					mirror.remove();
					style.whiteSpace = "pre";
				}
				Object.assign(style, {
					padding: computed.padding,
					display: "flex",
					alignItems: node instanceof HTMLTextAreaElement ? "flex-start" : "center",
					justifyContent:
						computed.textAlign === "right"
							? "flex-end"
							: computed.textAlign === "center"
								? "center"
								: "flex-start",
				});
				if (!(node instanceof HTMLTextAreaElement)) style.whiteSpace = "pre";
				if (
					node instanceof HTMLInputElement &&
					node.type === "number" &&
					computed.appearance === "auto"
				) {
					style.paddingRight = px(Number.parseFloat(computed.paddingRight) + 16);
					limitations.push({
						element: name,
						reason:
							"Chromium number input reserves a spinner lane even without hover; its 16px inset is a static browser-chrome approximation.",
					});
				}
				if (!node.value && !(node instanceof HTMLSelectElement))
					style.color = getComputedStyle(node, "::placeholder").color;
				if (node instanceof HTMLInputElement && node.type === "date") {
					const formatter = new Intl.DateTimeFormat(navigator.language, {
						day: "2-digit",
						month: "2-digit",
						year: "numeric",
					});
					value = node.value
						? formatter.format(new Date(`${node.value}T12:00:00`))
						: formatter
								.formatToParts(new Date(2000, 0, 2))
								.map((part) =>
									part.type === "year"
										? "yyyy"
										: part.type === "month"
											? "mm"
											: part.type === "day"
												? "dd"
												: part.value,
								)
								.join("");
					style.color = computed.color;
					limitations.push({
						element: name,
						reason:
							"Native date field: locale-format placeholder and editable calendar indicator are approximations; the browser calendar popup is not reproduced.",
					});
					return `<div layer-name="${escapeHtml(name)}" style="${escapeHtml(styleText(style))}">${escapeHtml(value)}<svg layer-name="Native calendar indicator" viewBox="0 0 14 14" style="position:absolute;left:${px(rect.width - 26)};top:${px((rect.height - 14) / 2)};width:14px;height:14px;fill:none;stroke:${escapeHtml(computed.color)};stroke-width:1.4px"><path d="M3 3H11Q12 3 12 4V11Q12 12 11 12H3Q2 12 2 11V4Q2 3 3 3ZM2 6H12M4 1V4M10 1V4"/></svg></div>`;
				}
				if (node instanceof HTMLInputElement && ["checkbox", "radio"].includes(node.type)) {
					limitations.push({
						element: name,
						reason: "Native checkbox/radio drawing needs a separate Paper comparison.",
					});
					if (computed.appearance !== "none") {
						const dark =
							computed.colorScheme.includes("dark") ||
							matchMedia("(prefers-color-scheme: dark)").matches;
						Object.assign(style, {
							backgroundColor: dark ? "#3b3b3b" : "#ffffff",
							border: "1px solid #858585",
							borderRadius: node.type === "radio" ? "50%" : "2px",
							padding: "0px",
							justifyContent: "center",
						});
					}
					return `<div layer-name="${escapeHtml(name)}" style="${escapeHtml(styleText(style))}">${node.checked ? "✓" : ""}</div>`;
				}
				if (node instanceof HTMLSelectElement) {
					limitations.push({
						element: name,
						reason:
							"Native select: selected text and bounds captured; its browser-owned popup is not reproduced. A native arrow, when present, is represented by an editable chevron.",
					});
					if (computed.appearance !== "none") {
						// Chromium's native select adds an inset beyond its CSS padding.
						style.paddingLeft = px(Number.parseFloat(computed.paddingLeft) + 4);
						const arrowStyle = {
							position: "absolute",
							left: px(rect.width - 13),
							top: px((rect.height - 6) / 2),
							width: "10px",
							height: "6px",
							fill: "none",
							stroke: computed.color,
							strokeWidth: "1.6px",
							strokeLinecap: "round",
							strokeLinejoin: "round",
						};
						return `<div layer-name="${escapeHtml(name)}" style="${escapeHtml(styleText(style))}">${escapeHtml(value)}<svg layer-name="Native select indicator" viewBox="0 0 10 6" style="${escapeHtml(styleText(arrowStyle))}"><path d="M1 1L5 5L9 1" style="fill:none;stroke:${escapeHtml(computed.color)};stroke-width:1.6px;stroke-linecap:round;stroke-linejoin:round"/></svg></div>`;
					}
				}
				return `<div layer-name="${escapeHtml(name)}" style="${escapeHtml(styleText(style))}">${escapeHtml(value)}</div>`;
			}
			const children = [...node.children].filter(visible);
			const directText = [...node.childNodes].filter(
				(child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim(),
			);
			let decoration = "";
			if (
				node.tagName === "LI" &&
				computed.display === "list-item" &&
				computed.listStyleType !== "none"
			) {
				const marker = getComputedStyle(node, "::marker");
				const lineHeight =
					Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.2;
				if (computed.listStyleType === "disc")
					decoration += `<div layer-name="List marker" style="position:absolute;left:${px(Number.parseFloat(computed.paddingLeft) - 23)};top:${px(lineHeight / 2 - 2.5)};width:5px;height:5px;border-radius:50%;background-color:${escapeHtml(marker.color)}"></div>`;
				else if (computed.listStyleType === "decimal") {
					const siblings = [...node.parentElement.children].filter(
						(child) => child.tagName === "LI",
					);
					const number = node.value || (node.parentElement.start || 1) + siblings.indexOf(node);
					decoration += `<div layer-name="List marker" style="position:absolute;left:-28px;top:0px;width:20px;height:${px(lineHeight)};text-align:right;font-family:${escapeHtml(computed.fontFamily)};font-size:${computed.fontSize};line-height:${px(lineHeight)};color:${escapeHtml(marker.color)}">${number}.</div>`;
				}
			}
			if (node.matches(".login-divider")) {
				for (const side of ["before", "after"]) {
					const rule = getComputedStyle(node, `::${side}`);
					const width = Number.parseFloat(rule.width);
					if (!Number.isFinite(width)) continue;
					decoration += `<div layer-name="Sign-in divider rule" style="position:absolute;left:${px(side === "before" ? 0 : rect.width - width)};top:${px((rect.height - 1) / 2)};width:${px(width)};height:1px;background-color:${escapeHtml(rule.backgroundColor)}"></div>`;
				}
			}
			// These implemented editor selection markers are otherwise absent from the DOM.
			const before = getComputedStyle(node, "::before");
			if (
				node.matches(".active, .selected") &&
				before.content === '""' &&
				before.position === "absolute" &&
				before.transform === "none"
			) {
				const marker = Object.fromEntries(
					["position", "left", "top", "width", "height", "backgroundColor"].map((property) => [
						property,
						before[property],
					]),
				);
				decoration += `<div layer-name="Active editor navigation marker" style="${escapeHtml(styleText(marker))}"></div>`;
			}
			if (!children.length) {
				if (node.matches(".nav-links a.active")) {
					const pseudo = getComputedStyle(node, "::after");
					decoration = `<div layer-name="Active navigation underline" style="position:absolute;left:0px;top:${px(rect.height)};width:${px(rect.width)};height:${pseudo.height};background-color:${pseudo.backgroundColor}"></div>`;
				}
				const range = document.createRange();
				range.selectNodeContents(node);
				if (node.tagName === "SUMMARY" && computed.display === "list-item") {
					const open = node.parentElement?.hasAttribute("open");
					const markerTop = (rect.height - 8) / 2;
					decoration += `<svg layer-name="Native disclosure indicator" viewBox="0 0 8 8" style="position:absolute;left:0px;top:${px(markerTop)};width:8px;height:8px;fill:${escapeHtml(computed.color)};stroke:none"><path d="${open ? "M0 1L8 1L4 7Z" : "M1 0L7 4L1 8Z"}" style="fill:${escapeHtml(computed.color)};stroke:none"/></svg>`;
				}
				const singleLine =
					["normal", "nowrap"].includes(computed.whiteSpace) &&
					range.getClientRects().length === 1 &&
					node.scrollWidth <= node.clientWidth + 1;
				Object.assign(style, {
					padding: computed.padding,
					display: computed.display.includes("flex") ? "flex" : "block",
					alignItems: computed.alignItems,
					justifyContent: computed.justifyContent,
				});
				if (node.tagName === "SUMMARY" && computed.display === "list-item")
					style.paddingLeft = px(range.getBoundingClientRect().left - rect.left);
				if (computed.display === "table-cell") {
					style.display = "flex";
					style.alignItems = computed.verticalAlign === "middle" ? "center" : "flex-start";
					style.justifyContent = computed.textAlign === "right" ? "flex-end" : "flex-start";
				}
				if (node instanceof HTMLButtonElement) {
					style.display = "flex";
					style.alignItems = "center";
					style.justifyContent = ["left", "start"].includes(computed.textAlign)
						? "flex-start"
						: ["right", "end"].includes(computed.textAlign)
							? "flex-end"
							: "center";
				}
				if (singleLine) {
					style.whiteSpace = "pre";
					if (computed.display === "inline")
						style.lineHeight = px(range.getBoundingClientRect().height);
				}
				const leafText = directText.map((child) => child.textContent).join("");
				let text = singleLine ? leafText.replace(/\s+/g, " ").trim() : leafText;
				if (!singleLine && computed.whiteSpace === "normal") {
					const lines = [];
					for (const line of directText.flatMap(textLines)) {
						const previous = lines.at(-1);
						if (previous && Math.abs(previous.rect.top - line.rect.top) < 0.5)
							previous.text += line.text;
						else lines.push(line);
					}
					if (lines.length > 1) {
						if (computed.display === "inline") {
							// Inline emphasis can start mid-line and resume at the next line's origin.
							const parts = lines.map((line, index) => {
								const lineStyle = {
									...style,
									left: px(line.rect.left - rect.left),
									top: px(line.rect.top - rect.top),
									width: px(line.rect.width + 0.1),
									height: px(line.rect.height),
									lineHeight: px(line.rect.height),
									whiteSpace: "pre",
								};
								return `<div layer-name="${escapeHtml(name)} line ${index + 1}" style="${escapeHtml(styleText(lineStyle))}">${escapeHtml(line.text.replace(/\s+/g, " ").trim())}</div>`;
							});
							return `<div layer-name="${escapeHtml(name)}" style="${escapeHtml(styleText(style))}">${parts.join("")}${decoration}</div>`;
						}
						const clamp = Number.parseInt(computed.webkitLineClamp, 10);
						const visibleLines = Number.isFinite(clamp) ? lines.slice(0, clamp) : lines;
						if (Number.isFinite(clamp) && lines.length > clamp) {
							const last = visibleLines.at(-1);
							const measure = document.createElement("canvas").getContext("2d");
							if (measure) {
								measure.font = computed.font;
								measure.letterSpacing = computed.letterSpacing;
								while (
									last.text &&
									measure.measureText(`${last.text.trimEnd()}…`).width > rect.width
								)
									last.text = [...last.text].slice(0, -1).join("");
							}
							last.text = `${last.text.trimEnd()}…`;
						}
						text = visibleLines.map((line) => line.text.replace(/\s+/g, " ").trim()).join("\n");
						style.whiteSpace = "pre";
					}
				}
				return `<div layer-name="${escapeHtml(name)}" style="${escapeHtml(styleText(style))}">${escapeHtml(text)}${decoration}</div>`;
			}
			const key = `fragment-${++nextKey}`;
			const shouldSplit =
				split &&
				(computed.position === "fixed" ||
					[
						"BODY",
						"MAIN",
						"NAV",
						"ASIDE",
						"SECTION",
						"TABLE",
						"TBODY",
						"UL",
						"FORM",
						"DIALOG",
					].includes(node.tagName) ||
					/(^|\s)[\w-]+-(footer|summary)(\s|$)/.test(name) ||
					children.length > 6 ||
					node.querySelector("table,ul,form") !== null ||
					(children.length > 1 &&
						node.querySelectorAll("a,button,input,img,tr,label,p").length > 1));
			const fragment = { key, parentKey, name, html: "", childHtml: [] };
			if (shouldSplit) fragments.push(fragment);
			let content = decoration;
			for (const child of directText) {
				for (const line of textLines(child)) {
					const bounds = line.rect;
					if (!bounds.width || !bounds.height) continue;
					const textStyle = {
						position: "absolute",
						left: px(bounds.left - rect.left),
						top: px(bounds.top - rect.top),
						width: px(bounds.width + 0.1),
						height: px(bounds.height),
						fontFamily: computed.fontFamily,
						fontSize: computed.fontSize,
						fontWeight: computed.fontWeight,
						lineHeight: px(bounds.height),
						color: computed.color,
						letterSpacing: computed.letterSpacing,
						textTransform: computed.textTransform,
						whiteSpace: "pre",
					};
					const text = ["normal", "nowrap"].includes(computed.whiteSpace)
						? line.text.replace(/\s+/g, " ")
						: line.text;
					content += `<div layer-name="${escapeHtml(text.trim().slice(0, 40))}" style="${escapeHtml(styleText(textStyle))}">${escapeHtml(text)}</div>`;
				}
			}
			const childHtml = children.map((child) =>
				serialize(child, rect, shouldSplit, shouldSplit ? key : parentKey),
			);
			const html = `<div layer-name="${escapeHtml(name)}" style="${escapeHtml(styleText(style))}">${content}${shouldSplit ? "" : childHtml.join("")}</div>`;
			if (shouldSplit) {
				fragment.html = html;
				fragment.childHtml = childHtml.filter(Boolean);
				return "";
			}
			return html;
		}
		const origin = { left: 0, top: 0 };
		serialize(document.body, origin, true);
		return {
			verificationStatus: "unverified",
			url: location.href,
			title: document.title,
			viewport: { width: innerWidth, height: innerHeight },
			theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
			period: document.documentElement.dataset.timePeriod,
			reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
			classification: document.documentElement.dataset.handbookFixture || "local-public-render",
			background: getComputedStyle(document.body).backgroundColor,
			fonts: [...document.fonts].map((font) => ({
				family: font.family,
				weight: font.weight,
				status: font.status,
			})),
			fragments,
			decorativeAssets,
			limitations,
		};
	});
	await fs.mkdir(outputDirectory, { recursive: true });
	for (const asset of snapshot.decorativeAssets) {
		const assetPath = path.resolve(outputDirectory, `${key}-${asset.key}.png`);
		await fs.writeFile(assetPath, Buffer.from(asset.dataUrl.split(",")[1], "base64"));
		for (const fragment of snapshot.fragments) {
			const replaceAsset = (html) =>
				html.replaceAll(`handbook-canvas://${asset.key}`, `paper-asset://${assetPath}`);
			fragment.html = replaceAsset(fragment.html);
			fragment.childHtml = fragment.childHtml.map(replaceAsset);
		}
	}
	delete snapshot.decorativeAssets;
	await page.screenshot({ path: path.join(outputDirectory, `${key}.png`) });
	await fs.writeFile(
		path.join(outputDirectory, `${key}.json`),
		`${JSON.stringify({ ...snapshot, capturedAt: new Date().toISOString() }, null, 2)}\n`,
	);
	return snapshot;
}

async function main() {
	const args = process.argv.slice(2);
	const argument = (name, fallback) =>
		args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
	const url = new URL(argument("--url", "http://127.0.0.1:5197/"));
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		!["127.0.0.1", "localhost"].includes(url.hostname) ||
		/\/(delivery|portal|api)(\/|$)/.test(url.pathname)
	)
		throw new Error("Capture only local public pages or isolated handbook fixtures");
	const output = argument("--out");
	if (!output) throw new Error("Pass --out with a private capture directory");
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({
			viewport: {
				width: Number(argument("--width", "1440")),
				height: Number(argument("--height", "1000")),
			},
			colorScheme: argument("--theme", "light"),
			reducedMotion: argument("--motion", "reduce"),
			timezoneId: "America/Detroit",
		});
		await page.clock.setFixedTime(new Date("2026-09-10T18:00:00Z"));
		await page.route("**/*", (route) =>
			["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort(),
		);
		await page.goto(url.href, { waitUntil: "networkidle" });
		const result = await captureHandbookPage(page, output, argument("--key", "screen"));
		console.log(
			JSON.stringify({
				key: argument("--key", "screen"),
				viewport: result.viewport,
				theme: result.theme,
				fragments: result.fragments.length,
				limitations: result.limitations,
			}),
		);
	} finally {
		await browser.close();
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
