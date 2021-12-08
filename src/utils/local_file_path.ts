import { statSync } from 'fs';
import { basename, dirname, resolve } from 'path';

export type FilePathAndName = [string, string?];

/**
 * Resolves the path, verifies its existance and type to conditionally return its dir and file name
 * @param {string} destOutputPath - the path from where to extract the dir path and name
 * @returns {FilePathAndName} - the directory where to put the file and the file name (which is undefined when the provided destOutputPath is a directory)
 */
export function getOutputFilePathAndName(destOutputPath: string): FilePathAndName {
	const resolvedOutputPath = resolve(destOutputPath);
	const outputDirname = dirname(resolvedOutputPath);
	const outputBasename = basename(resolvedOutputPath);
	try {
		const outputPathStats = statSync(resolvedOutputPath);
		// the destination does exist
		if (outputPathStats.isDirectory()) {
			// and is a directory
			return [resolvedOutputPath];
		} else if (outputPathStats.isFile()) {
			// as an existing file
			return [outputDirname, outputBasename];
		}
		throw new Error(`The destination isn't a folder nor a file!`);
	} catch (e) {
		// the destination doesn't exist
		const outputParentPathStats = statSync(outputDirname);
		// the parent exists
		if (outputParentPathStats.isDirectory()) {
			return [outputDirname, outputBasename];
		}
		throw new Error(`The path ${outputDirname} is not a directory!`);
	}
}
