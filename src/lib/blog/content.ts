export const BLOG_PRESENTATIONS = [
	"standard",
	"behindTheScenes",
	"caseStudy",
	"clientStory",
	"technical",
] as const;

export type BlogPresentation = (typeof BLOG_PRESENTATIONS)[number];

export type BlogImage = {
	src: string;
	alt: string;
	width: number;
	height: number;
	caption: string | null;
	framing: {
		crop: { top: number; right: number; bottom: number; left: number } | null;
		focus: { x: number; y: number; width: number; height: number } | null;
	} | null;
};

export type BlogAuthor = {
	name: string;
	image: BlogImage | null;
};

export type BlogCategory = {
	title: string;
};

export type BlogTextMark =
	| { type: "strong" }
	| { type: "emphasis" }
	| { type: "link"; href: string };

export type BlogTextSpan = {
	text: string;
	marks: BlogTextMark[];
};

export type BlogBlockStyle = "normal" | "h1" | "h2" | "h3" | "h4" | "blockquote";

export type BlogList = {
	type: "list";
	level: number;
	style: "bullet" | "number";
	items: BlogListItem[];
};

export type BlogListItem = {
	blockStyle: BlogBlockStyle;
	spans: BlogTextSpan[];
	children: BlogList[];
};

export type BlogTextBlock =
	| { type: "paragraph"; spans: BlogTextSpan[] }
	| { type: "heading"; level: 1 | 2 | 3 | 4; spans: BlogTextSpan[] }
	| { type: "quote"; spans: BlogTextSpan[] }
	| BlogList
	| { type: "image"; image: BlogImage };

export type BlogPostSummary = {
	siteUrl: string;
	title: string;
	slug: string;
	publishedAt: string;
	excerpt: string;
	presentation: BlogPresentation;
	author: BlogAuthor | null;
	categories: BlogCategory[];
	mainImage: BlogImage | null;
};

export type BlogTechnicalItem =
	| {
			kind: "photography";
			camera: string | null;
			lens: string | null;
			filmStock: string | null;
			developer: string | null;
	  }
	| {
			kind: "summary";
			label: string | null;
			details: string | null;
	  };

export type BlogPostDetail = BlogPostSummary & {
	seoTitle: string | null;
	seoDescription: string | null;
	brief: string | null;
	approach: string | null;
	outcome: string | null;
	credits: string | null;
	equipment: BlogTechnicalItem[];
	materials: BlogTechnicalItem[];
	body: BlogTextBlock[];
};
