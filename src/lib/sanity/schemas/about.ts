import { defineField, defineType } from 'sanity';

export const about = defineType({
	name: 'about',
	title: 'About',
	type: 'document',
	fields: [
		defineField({
			name: 'name',
			title: 'Artist Name',
			type: 'string',
			validation: (rule) => rule.required()
		}),
		defineField({
			name: 'portrait',
			title: 'Portrait',
			type: 'image',
			options: { hotspot: true }
		}),
		defineField({
			name: 'bio',
			title: 'Bio',
			type: 'array',
			of: [{ type: 'block' }]
		}),
		defineField({
			name: 'shortBio',
			title: 'Short Bio',
			type: 'text',
			rows: 3,
			description: 'Used for meta descriptions and previews'
		}),
		defineField({
			name: 'email',
			title: 'Contact Email',
			type: 'string'
		}),
		defineField({
			name: 'social',
			title: 'Social Links',
			type: 'object',
			fields: [
				defineField({ name: 'instagram', title: 'Instagram', type: 'url' }),
				defineField({ name: 'twitter', title: 'Twitter/X', type: 'url' }),
				defineField({ name: 'tiktok', title: 'TikTok', type: 'url' }),
				defineField({ name: 'website', title: 'Website', type: 'url' })
			]
		})
	],
	preview: {
		select: { title: 'name', media: 'portrait' }
	}
});
