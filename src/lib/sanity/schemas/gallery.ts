/**
 * Gallery Schema
 * Defines the structure for photo galleries in Sanity.
 * Each gallery has a title, slug, array of images, and optional metadata.
 */

import { defineField, defineType } from 'sanity';
import { orderRankField } from '@sanity/orderable-document-list';

export const gallery = defineType({
	name: 'gallery',
	title: 'Gallery',
	type: 'document',
	fields: [
		// orderRankField enables drag-and-drop ordering in the studio
		// Must be first field, and requires orderableDocumentListDeskItem in structure
		orderRankField({ type: 'gallery' }),

		defineField({
			name: 'title',
			title: 'Title',
			type: 'string',
			validation: (rule) => rule.required()
		}),

		// Slug is auto-generated from title, used in URLs (/gallery/[slug])
		defineField({
			name: 'slug',
			title: 'Slug',
			type: 'slug',
			options: { source: 'title', maxLength: 96 },
			validation: (rule) => rule.required()
		}),

		// Array of images with optional alt text for accessibility
		// Displayed as a grid in the studio for easy management
		defineField({
			name: 'images',
			title: 'Image',
			type: 'array',
			of: [
				defineField({
					name: 'image',
					type: 'image',
					options: { hotspot: true },  // Enables focal point cropping
					fields: [
						{
							name: 'alt',
							type: 'string',
							title: 'Alternative text',
						},
					],
				}),
			],
			options: {
				layout: 'grid',  // Shows images in a visual grid in Studio
			},
			validation: (rule) => rule.required()
		}),

		defineField({
			name: 'description',
			title: 'Description',
			type: 'text',
			rows: 3
		}),

		// Category for filtering/organization
		defineField({
			name: 'category',
			title: 'Category',
			type: 'string',
			options: {
				list: [
					{ title: 'Portrait', value: 'portrait' },
					{ title: 'Landscape', value: 'landscape' },
					{ title: 'Street', value: 'street' },
					{ title: 'Abstract', value: 'abstract' },
					{ title: 'Editorial', value: 'editorial' }
				]
			}
		}),

		// Flexible tags for additional categorization
		defineField({
			name: 'tags',
			title: 'Tags',
			type: 'array',
			of: [{ type: 'string' }],
			options: { layout: 'tags' }
		}),

		defineField({
			name: 'date',
			title: 'Date',
			type: 'date'
		}),

		// Featured flag for highlighting galleries
		defineField({
			name: 'featured',
			title: 'Featured',
			type: 'boolean',
			initialValue: false
		}),

		// Preview image (could be used for social sharing, etc.)
		defineField({
			name: 'previewImage',
			title: 'Preview Image (first image auto-selected)',
			type: 'image',
			options: { hotspot: true }
		}),
	],
	// Studio preview shows the title and first image from the array
	preview: {
		select: { 
			title: 'title', 
			media: 'images.0'
		}
	}
});
