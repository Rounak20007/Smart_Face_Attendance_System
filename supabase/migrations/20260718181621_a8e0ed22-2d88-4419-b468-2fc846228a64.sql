
CREATE POLICY "public read snapshots" ON storage.objects FOR SELECT USING (bucket_id = 'attendance-snapshots');
CREATE POLICY "public upload snapshots" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'attendance-snapshots');
