import { defineField, defineType } from 'sanity';

export const gallery = defineType({
	name: 'gallery',
	title: 'Gallery',
	type: 'document',
	fields: [
		defineField({
			name: 'title',
			title: 'Title',
			type: 'string',
			validation: (rule) => rule.required()
		}),
		defineField({
			name: 'slug',
			title: 'Slug',
			type: 'slug',
			options: { source: 'title', maxLength: 96 },
			validation: (rule) => rule.required()
		}),
		defineField({
			name: 'images',
			title: 'Image',
			type: 'array',
			of: [
				defineField({
				  name: 'image',
				  type: 'image',
				  options: {hotspot: true},
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
				layout: 'grid', // gives you a nice visual grid in Studio
			  },
			validation: (rule) => rule.required()
		}),
		defineField({
			name: 'description',
			title: 'Description',
			type: 'text',
			rows: 3
		}),
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
		defineField({
			name: 'featured',
			title: 'Featured',
			type: 'boolean',
			initialValue: false
		}),
		defineField({
			name: 'previewImage',
			title: 'Preview Image (first image auto-selected)',
			type: 'image',
			options: { source: 'images[0]' } // Auto-picks first image
		  }),
	],
	preview: {
		select: { title: 'title', media: 'image' }
	}
});
