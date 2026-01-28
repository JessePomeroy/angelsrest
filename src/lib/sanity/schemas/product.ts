import { defineField, defineType } from 'sanity';

export const product = defineType({
	name: 'product',
	title: 'Product',
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
			title: 'Images',
			type: 'array',
			of: [{ type: 'image', options: { hotspot: true } }],
			validation: (rule) => rule.required().min(1)
		}),
		defineField({
			name: 'price',
			title: 'Price (cents)',
			type: 'number',
			description: 'Price in cents (e.g., 2500 = $25.00)',
			validation: (rule) => rule.required().min(0)
		}),
		defineField({
			name: 'description',
			title: 'Description',
			type: 'text',
			rows: 4
		}),
		defineField({
			name: 'body',
			title: 'Full Description',
			type: 'array',
			of: [{ type: 'block' }]
		}),
		defineField({
			name: 'category',
			title: 'Category',
			type: 'string',
			options: {
				list: [
					{ title: 'Print', value: 'print' },
					{ title: 'Zine', value: 'zine' },
					{ title: 'Apparel', value: 'apparel' },
					{ title: 'Other', value: 'other' }
				]
			}
		}),
		defineField({
			name: 'variants',
			title: 'Variants',
			type: 'array',
			of: [
				{
					type: 'object',
					fields: [
						defineField({ name: 'name', title: 'Name', type: 'string' }),
						defineField({ name: 'price', title: 'Price (cents)', type: 'number' }),
						defineField({ name: 'sku', title: 'SKU', type: 'string' }),
						defineField({
							name: 'inStock',
							title: 'In Stock',
							type: 'boolean',
							initialValue: true
						})
					]
				}
			]
		}),
		defineField({
			name: 'inStock',
			title: 'In Stock',
			type: 'boolean',
			initialValue: true
		}),
		defineField({
			name: 'featured',
			title: 'Featured',
			type: 'boolean',
			initialValue: false
		})
	],
	preview: {
		select: { title: 'title', media: 'images.0' }
	}
});
