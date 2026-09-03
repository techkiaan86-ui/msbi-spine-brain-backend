import axios from 'axios';

const WP_BASE_URL = 'https://midwestspine.net/wp-json/wp/v2';

export interface WPPaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

export class WordPressService {
  /**
   * Health check to verify if the WordPress REST API is accessible.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${WP_BASE_URL}/types`, { timeout: 10000 });
      return response.status === 200;
    } catch (error) {
      console.error('WordPress health check failed:', error);
      return false;
    }
  }

  private parseParams(params: Record<string, any>) {
    const safeParams: Record<string, any> = {};
    const allowed = ['page', 'per_page', 'search', 'order', 'orderby', '_embed'];
    
    for (const key of allowed) {
      if (params[key] !== undefined) {
        safeParams[key] = params[key];
      }
    }
    
    if (!safeParams.per_page || safeParams.per_page > 100) {
      safeParams.per_page = 20; // Default limit
    }
    if (!safeParams.page) {
      safeParams.page = 1;
    }
    
    return safeParams;
  }

  private parsePagination(headers: any, params: Record<string, any>) {
    return {
      page: Number(params.page) || 1,
      perPage: Number(params.per_page) || 20,
      total: Number(headers['x-wp-total']) || 0,
      totalPages: Number(headers['x-wp-totalpages']) || 0
    };
  }

  private normalizePostLike(item: any) {
    return {
      id: item.id,
      date: item.date,
      modified: item.modified,
      slug: item.slug,
      status: item.status,
      link: item.link,
      title: item.title?.rendered || '',
      excerpt: item.excerpt?.rendered || '',
      content: item.content?.rendered || '',
      featuredMedia: item.featured_media || null,
      author: item.author || null,
      categories: item.categories || [],
      tags: item.tags || [],
      type: item.type || ''
    };
  }

  private normalizeMedia(item: any) {
    return {
      id: item.id,
      date: item.date,
      slug: item.slug,
      link: item.link,
      mediaType: item.media_type,
      mimeType: item.mime_type,
      sourceUrl: item.source_url,
      altText: item.alt_text || '',
      caption: item.caption?.rendered || '',
      title: item.title?.rendered || ''
    };
  }

  private async fetchPaginated(endpoint: string, params: Record<string, any>, normalizer: (item: any) => any): Promise<WPPaginatedResponse<any>> {
    try {
      const safeParams = this.parseParams(params);
      const response = await axios.get(`${WP_BASE_URL}/${endpoint}`, { params: safeParams, timeout: 15000 });
      
      const data = (response.data || []).map(normalizer);
      return {
        data,
        pagination: this.parsePagination(response.headers, safeParams)
      };
    } catch (error: any) {
      console.error(`WordPress ${endpoint} error:`, error.message);
      throw new Error(`Failed to fetch ${endpoint} from WordPress`);
    }
  }

  async getPosts(params: Record<string, any> = {}): Promise<WPPaginatedResponse<any>> {
    return this.fetchPaginated('posts', params, this.normalizePostLike);
  }

  async getPages(params: Record<string, any> = {}): Promise<WPPaginatedResponse<any>> {
    return this.fetchPaginated('pages', params, this.normalizePostLike);
  }

  async getConditionTreatments(params: Record<string, any> = {}): Promise<WPPaginatedResponse<any>> {
    return this.fetchPaginated('condition_treatments', params, this.normalizePostLike);
  }

  async getMedia(params: Record<string, any> = {}): Promise<WPPaginatedResponse<any>> {
    return this.fetchPaginated('media', params, this.normalizeMedia);
  }

  async getCategories(params: Record<string, any> = {}): Promise<WPPaginatedResponse<any>> {
    return this.fetchPaginated('categories', params, (item: any) => ({
      id: item.id, count: item.count, description: item.description, link: item.link, name: item.name, slug: item.slug
    }));
  }

  async getTags(params: Record<string, any> = {}): Promise<WPPaginatedResponse<any>> {
    return this.fetchPaginated('tags', params, (item: any) => ({
      id: item.id, count: item.count, description: item.description, link: item.link, name: item.name, slug: item.slug
    }));
  }

  async getTypes() {
    try {
      const response = await axios.get(`${WP_BASE_URL}/types`, { timeout: 10000 });
      return response.data;
    } catch (e) {
      throw new Error('Failed to fetch WordPress types');
    }
  }

  async getTaxonomies() {
    try {
      const response = await axios.get(`${WP_BASE_URL}/taxonomies`, { timeout: 10000 });
      return response.data;
    } catch (e) {
      throw new Error('Failed to fetch WordPress taxonomies');
    }
  }
}

export const wordpressService = new WordPressService();
