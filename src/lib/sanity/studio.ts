import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { visionTool } from '@sanity/vision';
import { schemaTypes } from './schemas';

export const config = defineConfig({
	name: 'andistillhearangels',
	title: 'and i still hear angels',
	projectId: import.meta.env.PUBLIC_SANITY_PROJECT_ID || 'your_project_id',
	dataset: import.meta.env.PUBLIC_SANITY_DATASET || 'production',
	basePath: '/studio',
	plugins: [structureTool(), visionTool()],
	schema: {
		types: schemaTypes
	}
});
