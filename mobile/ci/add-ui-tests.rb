# Adds the smoke test (mobile/ci/SmokeUITests.swift) to the app's Xcode project on the CI runner
# only, never committed (app-store-launch's mobile-ci): a UI test target AppUITests and a shared
# scheme AppSmoke that builds App and runs it.
#
#   ruby mobile/ci/add-ui-tests.rb mobile/ios/App/App.xcodeproj mobile/ci/SmokeUITests.swift
#
# Needs the xcodeproj gem (the workflow installs a pinned version).

require "xcodeproj"

project_path, test_file = ARGV
abort "usage: add-ui-tests.rb <App.xcodeproj> <SmokeUITests.swift>" if project_path.nil? || test_file.nil?

project = Xcodeproj::Project.open(project_path)
app = project.targets.find { |t| t.name == "App" } or abort "no App target"
abort "AppUITests is there already" if project.targets.any? { |t| t.name == "AppUITests" }

tests = project.new_target(:ui_test_bundle, "AppUITests", :ios, "15.0")
group = project.main_group.new_group("AppUITests")
tests.add_file_references([group.new_reference(File.expand_path(test_file))])
tests.add_dependency(app)
tests.build_configurations.each do |c|
  s = c.build_settings
  s["TEST_TARGET_NAME"] = "App"
  # Without it: "Multiple commands produce …" (app-store-launch's mobile-ci).
  s["PRODUCT_NAME"] = "$(TARGET_NAME)"
  s["PRODUCT_BUNDLE_IDENTIFIER"] = "com.edwardleeee.wargame.smoketests"
  s["GENERATE_INFOPLIST_FILE"] = "YES"
  s["SWIFT_VERSION"] = "5.0"
  s["TARGETED_DEVICE_FAMILY"] = "1"
  s["IPHONEOS_DEPLOYMENT_TARGET"] = "15.0"
  s["CODE_SIGN_STYLE"] = "Automatic"
end
project.save

scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(app, tests)
scheme.save_as(project_path, "AppSmoke", true)
puts "AppUITests and the AppSmoke scheme added to #{project_path}"
