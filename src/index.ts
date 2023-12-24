import axios from 'axios';
import child_process from 'child_process';
import loading from 'loading-cli';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import readline from 'readline';
//@ts-ignore
import TEMPLACE_CN from './template/template.zh.md';
//@ts-ignore
import TEMPLACE_EN from './template/template.en.md';

const homeDir = os.homedir();

const configFilePath = path.join(homeDir, '.config/clog-ai/config.json');

const command = process.argv[2]?.trim();

const isVerbose = process.argv.includes('--verbose')||process.argv.includes('-v');

if (command == 'init') {
  if (fs.existsSync(configFilePath)) {
    console.log(
      'config file already exists, please edit config file: ' +
      path.resolve(configFilePath)
    );
    process.exit(0);
  }
  const config = {
    language: 'zh',
    datasource: 'openai',
    openai_base_url: '',
    openai_api_key: '',
    azure_api_key: '',
    azure_deployment_id: '',
    azure_base_url: '',
    azure_model: '',
    azure_api_version: '',
  };
  const dirPath = path.dirname(configFilePath);

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2));
  console.log(
    'init success, please edit config file: ' + path.resolve(configFilePath)
  );


  process.exit(0);
}

if (!fs.existsSync(configFilePath)) {
  console.log('please run this command first: clog-ai init');
  process.exit(0);
}

const config = getConfig()
//valid_datasource: azure openai
const valid_datasource = ['azure', 'openai']

if(!config.datasource){
  console.log('Please specify the datasource in the configuration file: ' + path.resolve(configFilePath));
  process.exit(0);
}

if(!valid_datasource.includes(config.datasource)){
  console.log('Invalid datasource. Please check the configuration file: ' + path.resolve(configFilePath));
  process.exit(0);
}

if(config.datasource === 'openai' && (!config.openai_api_key)){
  console.log('Data source is OpenAI, but the corresponding configuration is missing. Please add it in the configuration file: ' + path.resolve(configFilePath))
  process.exit(0);
}

if (config.datasource === 'azure' && (!config.azure_api_key || !config.azure_deployment_id || !config.azure_base_url || !config.azure_model || !config.azure_api_version)) {
  console.log('Data source is Azure, but the corresponding configuration is missing. Please add it in the configuration file: ' + path.resolve(configFilePath))
  process.exit(0);
}

function getConfig() {
  const content = fs.readFileSync(configFilePath).toString();
  return JSON.parse(content || '{}');
}

async function gptRequestAzure(prompt: string) {
  const res = await axios.post(
    `${config.azure_base_url}/openai/deployments/${config.azure_deployment_id}/chat/completions?api-version=${config.azure_api_version}`,
    {
      model: 'gpt-3.5-turbo-16k',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    },
    {
      headers: {
        'api-key': config.azure_api_key,
      },
      timeout: 100000,
    }
  );
  return res.data.choices[0].message.content;
}

async function gptRequestOpenai(prompt: string) {
  const res = await axios.post(
    `https://${config.openai_base_url || 'api.openai.com'}/v1/chat/completions`,
    {
      model: 'gpt-3.5-turbo-16k',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    },
    {
      headers: {
        Authorization: `Bearer ${config.openai_api_key}`,
      },
      timeout: 100000,
    }
  );
  return res.data.choices[0].message.content;
}

export default async () => {
  // 执行 git diff，获取变更的文件内容
  const diff = child_process
    .execSync('git diff HEAD')
    .toString()
    .substring(0, 8000);

  const prompt = (config.language == 'zh' ? TEMPLACE_CN : TEMPLACE_EN).replace('{{diff}}', diff)
  const load = loading({
    text: 'Generating commit log...',
    color: 'yellow',
    interval: 100,
    frames: ['◰', '◳', '◲', '◱'],
  }).start();
  try {
    if (isVerbose) {
      console.log('--------- Input Prompt ----------');
      console.log(prompt);
    }
    const res = config.datasource === 'azure' ? await gptRequestAzure(prompt) : await gptRequestOpenai(prompt);

    if (isVerbose) {
      console.log('\n--------- Output ----------');
      console.log(res);
      console.log('-------------------');
    }
    const commitLog = res.match(/<output>([\s\S]*)<\/output>/)?.[1]?.trim();
    if (!commitLog) {
      throw new Error('No commit log generated');
    }
    load.stop();
    load.succeed('Generate commit log success');
    console.log('-------------------')
    console.log(commitLog);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('-------------------')
    rl.question('Submit git commit with the log? (yes/no) ', (answer) => {
      if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        child_process.execSync(`git commit -m "${commitLog}"`);
        load.succeed('commit success');
      } else {
      }

      rl.close();
    });


  } catch (e) {
    load.stop();
    load.fail('Generate commit log fail');
    console.error(e.message);
  }
};
