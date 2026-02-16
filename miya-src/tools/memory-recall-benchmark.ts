import { runMemoryRecallBenchmark } from '../src/companion/memory-recall-benchmark';

const datasetPathArg = process.argv.find((item) => item.startsWith('--dataset='));
const datasetPath = datasetPathArg ? datasetPathArg.slice('--dataset='.length) : undefined;

const report = runMemoryRecallBenchmark({ datasetPath });
console.log(JSON.stringify(report, null, 2));
