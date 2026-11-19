"""Run without Docker: verify update ordering and stop-on-backup-failure."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class UpdateTest(unittest.TestCase):
    def run_update(self, fail=False, import_bundle=False, fail_import=False):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        (root / 'deploy').mkdir()
        shutil.copy(Path(__file__).resolve().parents[1] / 'update.sh', root / 'deploy/update.sh')
        (root / '.env').write_text('DB_PASSWORD=test\n')
        bin_dir = root / 'bin'
        bin_dir.mkdir()
        docker = bin_dir / 'docker'
        docker.write_text('''#!/usr/bin/env python3
import os, sys, io, tarfile
from pathlib import Path
args=sys.argv[1:]
with open('calls.log','a') as f:f.write(' '.join(args)+'\\n')
if 'pg_dump' in ' '.join(args):
 if os.environ.get('FAIL_BACKUP'):sys.exit(2)
 print('-- test database snapshot')
elif 'tar' in args:
 with tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz') as t:
  info=tarfile.TarInfo('uploads/example.xlsx');data=b'preserved upload';info.size=len(data);t.addfile(info,io.BytesIO(data))
elif 'reviewed-package' in args:
 secret=sys.stdin.readline().strip()
 Path('received-key-length').write_text(str(len(secret)))
 if os.environ.get('FAIL_IMPORT'):sys.exit(3)
 print('import OK')
else:print('OK')
''')
        docker.chmod(0o755)
        env = {**os.environ, 'PATH': str(bin_dir) + ':' + os.environ['PATH'], 'FT_NO_PULL': '1'}
        if import_bundle:
            key = root / 'secret.ftkey'
            key.write_text('private-unit-test-key\n')
            key.chmod(0o600)
            env.update(FT_IMPORT_REVIEWED_BUNDLE='1', FT_BUNDLE_KEY_FILE=str(key))
        if fail_import:
            env['FAIL_IMPORT'] = '1'
        if fail:
            env['FAIL_BACKUP'] = '1'
        result = subprocess.run(['bash', str(root / 'deploy/update.sh')], cwd=root, env=env, capture_output=True, text=True)
        return root, result

    def test_update_keeps_database_and_uploads(self):
        root, result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = (root / 'calls.log').read_text().splitlines()
        self.assertIn('pg_dump', calls[0])
        self.assertIn('tar -C /app/backend -czf - uploads', calls[1])
        self.assertEqual(calls[2], 'compose build backend')
        self.assertEqual(calls[3], 'compose up -d --no-deps backend')
        self.assertFalse(any(' down' in c or 'volume rm' in c or 'import-history' in c or 'init-users' in c for c in calls))
        snapshot = next((root / 'backups').iterdir())
        self.assertEqual((snapshot / 'server.env').read_bytes(), (root / '.env').read_bytes())
        self.assertEqual((snapshot / 'server.env').stat().st_mode & 0o777, 0o600)
        self.assertTrue((snapshot / 'database.sql.gz').exists())
        self.assertTrue((snapshot / 'uploads.tar.gz').exists())

    def test_bundle_runs_only_when_requested_after_backup_and_restart_without_key_in_logs(self):
        root, result = self.run_update(import_bundle=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = (root / 'calls.log').read_text()
        self.assertLess(calls.index('pg_dump'), calls.index('reviewed-package'))
        self.assertLess(calls.index('up -d'), calls.index('reviewed-package'))
        self.assertIn('reviewed-package --key-stdin --apply', calls)
        self.assertEqual((root / 'received-key-length').read_text(), str(len('private-unit-test-key')))
        self.assertNotIn('private-unit-test-key', calls + result.stdout + result.stderr)

    def test_failed_bundle_does_not_report_success(self):
        root, result = self.run_update(import_bundle=True, fail_import=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('пакет не применён', result.stdout + result.stderr)
        self.assertNotIn('Готово — FiberTrack обновлён', result.stdout)

    def test_failed_backup_prevents_rebuild(self):
        root, result = self.run_update(fail=True)
        self.assertNotEqual(result.returncode, 0)
        calls = (root / 'calls.log').read_text()
        self.assertNotIn('build backend', calls)
        self.assertNotIn('up -d', calls)


if __name__ == '__main__':
    unittest.main()
