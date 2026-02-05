/**
 * Sanity Studio Configuration
 * Configures the embedded Sanity Studio at /studio
 */

import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { visionTool } from '@sanity/vision';
import { orderableDocumentListDeskItem } from '@sanity/orderable-document-list';
import { schemaTypes } from './schemas';

export const config = defineConfig({
    name: 'andistillhearangels',
    title: 'angelsrest',
    projectId: import.meta.env.VITE_SANITY_PROJECT_ID,
    dataset: import.meta.env.VITE_SANITY_DATASET || 'production',
    basePath: '/studio',
    plugins: [
        // Structure tool with custom document organization
        structureTool({
            structure: (S: any, context: any) =>
                S.list()
                    .title('Content')
                    .items([
                        // Galleries get drag-and-drop ordering via the orderable plugin
                        // This creates a special list view with drag handles
                        orderableDocumentListDeskItem({
                            type: 'gallery',
                            title: 'Galleries',
                            S,
                            context,
                        }),
                        S.divider(),
                        // Include all other document types with default list views
                        // (filtered to exclude gallery since it's handled above)
                        ...S.documentTypeListItems().filter(
                            (item: { getId?: () => string }) => item.getId?.() !== 'gallery'
                        ),
                    ]),
        }),
        // Vision tool for testing GROQ queries
        visionTool(),
    ],
    schema: {
        types: schemaTypes
    }
});
