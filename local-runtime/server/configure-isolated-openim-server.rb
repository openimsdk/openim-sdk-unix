#!/usr/bin/env ruby

require 'fileutils'
require 'json'
require 'yaml'

source_root = File.expand_path(ENV.fetch('OPENIM_PUBLIC_SERVER_SOURCE'))
runtime_dir = File.join(source_root, '.openim-public-test')
snapshot_root = File.join(runtime_dir, 'source-snapshot')
config_root = File.join(runtime_dir, 'config')
data_root = File.expand_path(ENV.fetch('OPENIM_PUBLIC_SERVER_DATA_ROOT'))
public_host = ENV.fetch('OPENIM_PUBLIC_SERVER_PUBLIC_HOST')
project = 'openim-public-test'
project_prefix = 'openim-public-test-'

ports = {
  api: Integer(ENV.fetch('OPENIM_PUBLIC_SERVER_API_PORT', '11002')),
  websocket: Integer(ENV.fetch('OPENIM_PUBLIC_SERVER_WS_PORT', '11001')),
  mongo: Integer(ENV.fetch('OPENIM_PUBLIC_SERVER_MONGO_PORT', '47017')),
  redis: Integer(ENV.fetch('OPENIM_PUBLIC_SERVER_REDIS_PORT', '26379')),
  etcd_client: Integer(ENV.fetch('OPENIM_PUBLIC_SERVER_ETCD_CLIENT_PORT', '22379')),
  etcd_peer: Integer(ENV.fetch('OPENIM_PUBLIC_SERVER_ETCD_PEER_PORT', '22380')),
  kafka: Integer(ENV.fetch('OPENIM_PUBLIC_SERVER_KAFKA_PORT', '29094')),
  minio: Integer(ENV.fetch('OPENIM_PUBLIC_SERVER_MINIO_PORT', '20005')),
  minio_console: Integer(ENV.fetch('OPENIM_PUBLIC_SERVER_MINIO_CONSOLE_PORT', '29090')),
}

unless ports.values.uniq.length == ports.length && ports.values.all? { |port| port.between?(1024, 65_535) }
  abort 'isolated OpenIM ports must be unique values between 1024 and 65535'
end

commercial_ports = [10_001, 10_002, 10_005, 12_379, 12_380, 16_379, 19_094, 19_090, 37_017]
unless (ports.values & commercial_ports).empty?
  abort 'isolated OpenIM ports overlap the reserved commercial deployment range'
end

def load_yaml(path)
  source = File.read(path)
  source = source.gsub(/(\[\s*|,\s*)([A-Za-z0-9_.-]+:\d+)(?=\s*(?:,|\]))/) do
    "#{Regexp.last_match(1)}\"#{Regexp.last_match(2)}\""
  end
  YAML.safe_load(source, aliases: true) || {}
end

def write_yaml(path, document)
  File.write(path, YAML.dump(document))
end

def update_yaml(path)
  document = load_yaml(path)
  yield document
  write_yaml(path, document)
end

FileUtils.mkdir_p(runtime_dir)
FileUtils.mkdir_p(data_root)
FileUtils.rm_rf(config_root)
FileUtils.cp_r(File.join(snapshot_root, 'config'), config_root)
FileUtils.cp(File.join(snapshot_root, 'start-config.yml'), File.join(runtime_dir, 'start-config.yml'))

compose = load_yaml(File.join(snapshot_root, 'docker-compose.yml'))
service_names = %w[mongodb redis etcd kafka minio]
compose['services'] = (compose['services'] || {}).select { |name, _service| service_names.include?(name) }
container_suffix = { 'mongodb' => 'mongo', 'redis' => 'redis', 'etcd' => 'etcd', 'kafka' => 'kafka', 'minio' => 'minio' }

compose['services'].each do |name, service|
  service['container_name'] = "#{project_prefix}#{container_suffix.fetch(name)}"
  service.delete('network_mode')
  service['networks'] = [project]
  service['volumes'] = Array(service['volumes']).map do |entry|
    source, destination = entry.to_s.split(':', 2)
    source = source.sub('${DATA_DIR}', data_root)
    destination.nil? ? source : "#{source}:#{destination}"
  end
end

compose['services'].fetch('mongodb')['ports'] = ["#{ports[:mongo]}:27017"]
compose['services'].fetch('redis')['ports'] = ["#{ports[:redis]}:6379"]
compose['services'].fetch('etcd')['ports'] = ["#{ports[:etcd_client]}:2379", "#{ports[:etcd_peer]}:2380"]
compose['services'].fetch('kafka')['ports'] = ["#{ports[:kafka]}:9094"]
compose['services'].fetch('kafka').fetch('environment')['KAFKA_CFG_ADVERTISED_LISTENERS'] = "INTERNAL://kafka:9092,EXTERNAL://localhost:#{ports[:kafka]}"
compose['services'].fetch('minio')['ports'] = ["#{ports[:minio]}:9000", "#{ports[:minio_console]}:9090"]
compose['networks'] = { project => { 'name' => project, 'driver' => 'bridge' } }
write_yaml(File.join(runtime_dir, 'docker-compose.yml'), compose)

update_yaml(File.join(config_root, 'discovery.yml')) do |document|
  document['enable'] = 'etcd'
  document['etcd'] ||= {}
  document['etcd']['rootDirectory'] = project
  document['etcd']['address'] = ["localhost:#{ports[:etcd_client]}"]
end

update_yaml(File.join(config_root, 'mongodb.yml')) do |document|
  document['address'] = ["localhost:#{ports[:mongo]}"]
end

update_yaml(File.join(config_root, 'redis.yml')) do |document|
  document['address'] = ["localhost:#{ports[:redis]}"]
end


update_yaml(File.join(config_root, 'kafka.yml')) do |document|
  document['address'] = ["localhost:#{ports[:kafka]}"]
end


update_yaml(File.join(config_root, 'minio.yml')) do |document|
  document['internalAddress'] = "localhost:#{ports[:minio]}"
  document['externalAddress'] = "http://#{public_host}:#{ports[:minio]}"
end


Dir[File.join(config_root, 'openim-*.yml')].each do |path|
  update_yaml(path) do |document|
    document['rpc']['autoSetPorts'] = true if document['rpc'].is_a?(Hash)
    document['prometheus']['autoSetPorts'] = true if document['prometheus'].is_a?(Hash)
  end
end

update_yaml(File.join(config_root, 'openim-api.yml')) do |document|
  document.fetch('api')['ports'] = [ports[:api]]
end

update_yaml(File.join(config_root, 'openim-msggateway.yml')) do |document|
  document.fetch('longConnSvr')['ports'] = [ports[:websocket]]
end

update_yaml(File.join(runtime_dir, 'start-config.yml')) do |document|
  binaries = document.fetch('serviceBinaries')
  binaries['openim-push'] = 1
  binaries['openim-msgtransfer'] = 1
end

identity = {
  schemaVersion: 1,
  project: project,
  sourceRevision: ENV.fetch('OPENIM_PUBLIC_SERVER_REVISION'),
  publicHost: public_host,
  ports: ports,
  dataRoot: data_root,
}
File.write(File.join(runtime_dir, 'identity.json'), "#{JSON.pretty_generate(identity)}\n")
