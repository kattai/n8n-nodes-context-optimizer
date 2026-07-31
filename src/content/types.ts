import type { OptimizerProfileName } from '../core/types';

export type ContentType =
	| 'auto'
	| 'text'
	| 'json'
	| 'logs'
	| 'html'
	| 'rag'
	| 'tool_output'
	| 'code';

export type DetectedContentType = Exclude<ContentType, 'auto'>;

export interface ContentOptimizationOptions {
	contentType?: ContentType;
	currentTask?: string;
	profile?: OptimizerProfileName;
	protectedValues?: string[] | string;
	includeFields?: string[];
	excludeFields?: string[];
	removeNulls?: boolean;
	removeEmptyStrings?: boolean;
	includeJsonPaths?: string[];
	excludeJsonPaths?: string[];
	protectedJsonPaths?: string[];
	dictionaryEncoding?: boolean;
}

export interface ContentManifest {
	contentType: DetectedContentType;
	originalHash: string;
	originalBytes: number;
	optimizedBytes: number;
	recordCount?: number;
	fields?: string[];
	format?: 'text' | 'json' | 'json-table' | 'json-pack-v2' | 'logs' | 'html-text';
	roundTripVerified?: boolean;
}

export interface QualityCheck {
	name: string;
	passed: boolean;
	detail?: string;
}

export interface ContentQuality {
	passed: boolean;
	score: number;
	checks: QualityCheck[];
	warnings: string[];
	fallbackUsed: boolean;
	fallbackReason?: string;
}

export interface ContentTokenMetrics {
	original: number;
	optimized: number;
	saved: number;
	savingsPercent: number;
	areEstimated: true;
}

export interface ContentOptimizationResult {
	optimizedContent: string;
	contentType: DetectedContentType;
	strategies: string[];
	tokens: ContentTokenMetrics;
	quality: ContentQuality;
	manifest: ContentManifest;
}

export interface CompressorResult {
	content: string;
	strategies: string[];
	recordCount?: number;
	fields?: string[];
	format: NonNullable<ContentManifest['format']>;
	roundTripVerified?: boolean;
}
