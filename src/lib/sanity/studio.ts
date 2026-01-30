import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { visionTool } from '@sanity/vision';
import { schemaTypes } from './schemas';

export const config = defineConfig({
	name: 'andistillhearangels',
	title: 'angelsrest',
	projectId: import.meta.env.VITE_SANITY_PROJECT_ID,
	dataset: import.meta.env.VITE_SANITY_DATASET || 'production',
	basePath: '/studio',
	plugins: [structureTool(), visionTool()],
	schema: {
		types: schemaTypes
	}
});
