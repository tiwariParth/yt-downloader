#!/usr/bin/env node
import inquirer from 'inquirer';
import ytdl from 'ytdl-core';
import ora from 'ora';
import { VideoFormat, DownloadOptions } from './types';

async function validateYouTubeUrl(url: string): Promise<boolean> {
    return ytdl.validateURL(url);
}

async function getVideoInfo(url: string) {
    try {
        const info = await ytdl.getInfo(url);
        return info;
    } catch (error) {
        throw new Error('Failed to get video information');
    }
}

async function downloadVideo(options: DownloadOptions) {
    const spinner = ora('Starting download...').start();
    
    try {
        const info = await getVideoInfo(options.url);
        const filename = `${info.videoDetails.title}.${options.format === 'audio' ? 'mp3' : 'mp4'}`;
        
        if (options.format === 'audio') {
            ytdl(options.url, {
                filter: 'audioonly',
            }).pipe(require('fs').createWriteStream(filename));
        } else {
            ytdl(options.url, {
                filter: format => format.hasVideo && format.hasAudio,
                quality: options.quality
            }).pipe(require('fs').createWriteStream(filename));
        }
        
        spinner.succeed('Download completed!');
    } catch (error) {
        spinner.fail('Download failed!');
        console.error(error);
    }
}

async function main() {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'url',
            message: 'Enter YouTube video URL:',
            validate: validateYouTubeUrl
        },
        {
            type: 'list',
            name: 'format',
            message: 'Choose format:',
            choices: ['video', 'audio']
        }
    ]);

    await downloadVideo({
        url: answers.url,
        format: answers.format
    });
}

main().catch(console.error);