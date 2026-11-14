import { supabase, isSupabaseConfigured } from './supabase';

const BUCKET_NAME = 'media-uploads';

export interface StorageUploadResult {
  url: string;
  path?: string;
  isBase64Fallback?: boolean;
}

/**
 * Compresses an image before uploading or converting (loads compressor on-demand).
 */
export async function compressImageFile(file: File | Blob, filename = 'image.jpg'): Promise<File> {
  if (file.type && !file.type.startsWith('image/')) {
    if (file instanceof File) return file;
    return new File([file], filename, { type: file.type || 'application/octet-stream' });
  }

  try {
    const { default: imageCompression } = await import('browser-image-compression');
    const options = {
      maxSizeMB: 0.3,
      maxWidthOrHeight: 1280,
      useWebWorker: true,
      fileType: 'image/jpeg',
      initialQuality: 0.8
    };
    const compressedBlob = await imageCompression(file as File, options);
    const nameWithJpegExt = filename.replace(/\.[^/.]+$/, "") + ".jpg";
    return new File([compressedBlob], nameWithJpegExt, {
      type: 'image/jpeg',
      lastModified: Date.now()
    });
  } catch (err) {
    console.warn("Client-side image compression failed, using original file:", err);
    if (file instanceof File) return file;
    return new File([file], filename, { type: 'image/jpeg' });
  }
}

/**
 * Converts a Blob or File into a compressed Base64 data URL.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read blob as Base64 string"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Converts a Base64 data URL back into a Blob.
 */
export function base64ToBlob(base64Data: string): { blob: Blob; mimeType: string } {
  const parts = base64Data.split(';base64,');
  const mimeType = parts[0].replace('data:', '') || 'application/octet-stream';
  const byteCharacters = atob(parts[1]);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return { blob: new Blob([byteArray], { type: mimeType }), mimeType };
}

/**
 * Uploads a file/blob to Supabase Storage.
 * Stores media path or public URL.
 * Fallbacks cleanly to compressed Base64 data URL if Supabase Storage is not configured.
 */
export async function uploadMedia(
  fileOrBlob: File | Blob, 
  folder = 'general', 
  customFilename?: string
): Promise<StorageUploadResult> {
  // Compress if image
  const filename = customFilename || (fileOrBlob instanceof File ? fileOrBlob.name : `file_${Date.now()}.jpg`);
  const processedFile = await compressImageFile(fileOrBlob, filename);

  if (isSupabaseConfigured && supabase) {
    try {
      const fileExt = processedFile.name.split('.').pop() || 'jpg';
      const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
      const storagePath = `${cleanFolder}/${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;

      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(storagePath, processedFile, {
          cacheControl: '3600',
          upsert: true
        });

      if (error) {
        console.warn("Supabase Storage upload error, falling back to compressed base64:", error.message);
        const base64Url = await blobToBase64(processedFile);
        return { url: base64Url, isBase64Fallback: true };
      }

      // Get public URL
      const { data: publicUrlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(data.path);

      return {
        url: publicUrlData.publicUrl,
        path: data.path,
        isBase64Fallback: false
      };
    } catch (err) {
      console.warn("Supabase Storage exception, using base64 fallback:", err);
      const base64Url = await blobToBase64(processedFile);
      return { url: base64Url, isBase64Fallback: true };
    }
  }

  // Fallback if Supabase Storage is not configured
  const base64Url = await blobToBase64(processedFile);
  return { url: base64Url, isBase64Fallback: true };
}

/**
 * Uploads a Base64 media string to Supabase Storage if it's a data URL.
 */
export async function uploadBase64Media(
  base64Data: string, 
  folder = 'media'
): Promise<string> {
  if (!base64Data || !base64Data.startsWith('data:')) {
    // Already a HTTP URL or path
    return base64Data;
  }

  try {
    const { blob, mimeType } = base64ToBlob(base64Data);
    const ext = mimeType.split('/')[1] || 'jpg';
    const filename = `upload_${Date.now()}.${ext}`;
    const file = new File([blob], filename, { type: mimeType });

    const result = await uploadMedia(file, folder);
    return result.url;
  } catch (err) {
    console.warn("Failed to upload base64 to storage, keeping raw base64:", err);
    return base64Data;
  }
}

/**
 * Removes a file from Supabase Storage by path or URL.
 */
export async function deleteMediaFile(pathOrUrl: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !pathOrUrl || pathOrUrl.startsWith('data:')) {
    return false;
  }

  try {
    let filePath = pathOrUrl;
    if (pathOrUrl.includes(BUCKET_NAME)) {
      filePath = pathOrUrl.split(`${BUCKET_NAME}/`)[1];
    }

    if (!filePath) return false;

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) {
      console.warn("Failed to delete media from Supabase Storage:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Error deleting media file from Supabase:", err);
    return false;
  }
}
