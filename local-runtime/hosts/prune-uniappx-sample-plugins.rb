#!/usr/bin/env ruby

require 'xcodeproj'

project_path = ARGV.fetch(0)
application_id = ARGV.fetch(1)
project = Xcodeproj::Project.open(project_path)
target = project.targets.find { |candidate| candidate.name == 'UniAppX' }
raise 'UniAppX target not found' unless target
target.build_configurations.each do |configuration|
  configuration.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = application_id
end

sample_reference = lambda do |build_file|
  reference = build_file.file_ref
  next false unless reference

  name = reference.display_name.to_s
  name.start_with?('unimodule') && name != 'unimoduleUnixOpenimSdk.framework'
end

target.frameworks_build_phase.files.select(&sample_reference).each(&:remove_from_project)
target.copy_files_build_phases.each do |phase|
  phase.files.select(&sample_reference).each(&:remove_from_project)
end
target.dependencies.each do |dependency|
  dependency.remove_from_project if dependency.target&.name.to_s.start_with?('unimodule')
end
target.shell_script_build_phases
  .select { |phase| phase.name == '[CP] Embed Pods Frameworks' }
  .each(&:remove_from_project)

project.save
